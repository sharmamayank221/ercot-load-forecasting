"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { get, fmt } from "@/lib/api";
import { PageTitle, Stat, Section, ErrorNote, Loading } from "@/components/ui";
import LoadRibbon from "@/components/LoadRibbon";

type Summary = {
  hours: number; start: string; end: string; record_mw: number; record_time: string; avg_2018: number; avg_2026: number;
  yearly: { year: number; average: number; peak: number }[];
  leaderboard: { model: string; r2: number; mae: number; mape: number }[];
  zone_share: { zone: string; mw: number }[];
  latest_day: { date: string; points: { hour: number; mw: number; temp_f: number }[] };
};

const nice: Record<string, string> = { naive_last_week: "Same hour last week", decision_tree: "Decision tree", bagging: "Bagging", random_forest: "Random forest", gradient_boosting: "Gradient boosting", xgboost: "XGBoost", stacking: "Stacking" };

export default function Overview() {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { get<Summary>("/api/summary").then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorNote error={err} />;
  if (!s) return <Loading />;
  const growth = (s.avg_2026 / s.avg_2018 - 1) * 100;
  const best = s.leaderboard[0];
  const yearly = s.yearly.map((y) => ({ ...y, label: String(y.year) }));

  return (
    <>
      <PageTitle sub={`Hourly electricity demand across ERCOT's eight weather zones, ${s.start} to ${s.end}, with day-ahead forecasts from an ensemble of tree models.`}>
        How much power Texas needs tomorrow
      </PageTitle>

      <LoadRibbon points={s.latest_day.points} date={s.latest_day.date} />

      <div className="mt-10 grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat label="Hours of data" value={fmt(s.hours)} hint="8 zones, hourly" />
        <Stat label="Record system peak" value={`${fmt(s.record_mw / 1000, 1)} GW`} hint={s.record_time.slice(0, 16).replace("T", " ")} accent />
        <Stat label="Average demand, 2026 vs 2018" value={`+${growth.toFixed(0)}%`} hint={`${fmt(s.avg_2018 / 1000, 1)} to ${fmt(s.avg_2026 / 1000, 1)} GW`} />
        {best && <Stat label="Best model error, 2026" value={`${best.mape.toFixed(2)}%`} hint={`${nice[best.model] ?? best.model}, MAPE`} />}
      </div>

      <div className="grid gap-x-10 md:grid-cols-5">
        <div className="md:col-span-3"><Section title="Demand keeps climbing" aside="system load by year, MW">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={yearly} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `${v / 1000}k`} width={40} />
                <Tooltip formatter={(v) => `${fmt(Number(v))} MW`} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Bar dataKey="average" name="average" fill="var(--sky)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="peak" name="peak hour" fill="var(--heat)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section></div>
        <div className="md:col-span-2"><Section title="Which model to trust" aside="error on 2026, lower is better">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={[...s.leaderboard].reverse()} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" hide domain={[0, "dataMax + 1"]} />
                <YAxis type="category" dataKey="model" width={120} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(m) => nice[m] ?? m} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(2)}% MAPE`} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Bar dataKey="mape" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 12, formatter: (v: unknown) => `${Number(v).toFixed(1)}%` }}>
                  {[...s.leaderboard].reverse().map((r) => <Cell key={r.model} fill={r.model === best.model ? "var(--heat)" : "var(--sky)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section></div>
      </div>

      <Section title="Where the load is" aside="average 2026 load by zone">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {[...s.zone_share].sort((a, b) => b.mw - a.mw).map((z) => (
            <div key={z.zone} className="min-w-[120px]">
              <div className="text-[13px] text-muted">{z.zone}</div>
              <div className="num text-[22px] font-extrabold">{fmt(z.mw / 1000, 1)} <span className="text-[13px] font-medium text-muted">GW</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-sky" style={{ width: `${Math.max(8, (z.mw / s.zone_share.reduce((a, b) => Math.max(a, b.mw), 0)) * 120)}px` }} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
