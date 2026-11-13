"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { get, fmt } from "@/lib/api";
import { PageTitle, Section, Stat, ErrorNote, Loading } from "@/components/ui";

type P = { days: { day: string; peak_mw: number; cutoff_mw: number; high: boolean }[]; share_by_year: { year: number; pct: number }[];
  classifier: { model: string; recall: number; precision: number; F1: number; PR_AUC: number }[] };

export default function Peaks() {
  const [p, setP] = useState<P | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { get<P>("/api/peaks").then(setP).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorNote error={err} />;
  if (!p) return <Loading />;
  const share = p.days.filter((d) => d.high).length / p.days.length;
  const data = p.days.map((d, i) => ({ ...d, i, t: new Date(d.day).getTime() }));
  const years = Array.from(new Set(p.days.map((d) => d.day.slice(0, 4))));

  return (
    <>
      <PageTitle sub="A day counts as high-peak when its highest hour, relative to the trailing year's average peak, is above the 90th percentile for that month over the previous two years. Dividing by the trailing average removes demand growth.">The days that strain the grid</PageTitle>
      <div className="grid grid-cols-3 gap-8">
        <Stat label="Days labelled" value={fmt(p.days.length)} hint={`${years[0]} to ${years[years.length - 1]}`} />
        <Stat label="High-peak days" value={`${(share * 100).toFixed(1)}%`} hint="about 1 day in 7" accent />
        <Stat label="Best classifier, PR-AUC" value={Math.max(...p.classifier.filter((c) => c.PR_AUC).map((c) => c.PR_AUC)).toFixed(2)} hint="test years 2025 to 2026" />
      </div>
      <Section title="Every day's peak against the moving cutoff" aside="orange dots crossed the line">
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickLine={false} axisLine={false} fontSize={12}
                tickFormatter={(t) => new Date(t).getFullYear().toString()} ticks={years.map((y) => new Date(`${y}-01-01`).getTime())} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
              <Tooltip labelFormatter={(t) => new Date(Number(t)).toISOString().slice(0, 10)} formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} />
              <Scatter dataKey="peak_mw" name="daily peak" isAnimationActive={false}>
                {data.map((d) => <Cell key={d.day} fill={d.high ? "var(--heat)" : "var(--sky)"} fillOpacity={d.high ? 0.9 : 0.35} r={d.high ? 3 : 2} />)}
              </Scatter>
              <Line dataKey="cutoff_mw" name="cutoff" stroke="var(--ink)" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <div className="grid gap-x-10 md:grid-cols-2">
        <div><Section title="Share of high-peak days by year">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={p.share_by_year}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={32} unit="%" />
                <Tooltip formatter={(v) => `${v}%`} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Bar dataKey="pct" fill="var(--heat)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section></div>
        <div><Section title="Predicting tomorrow's label" aside="test years 2025 to 2026">
          <table className="w-full text-[14px]">
            <thead className="text-left text-muted"><tr><th className="py-1 font-medium">model</th><th className="font-medium">recall</th><th className="font-medium">precision</th><th className="font-medium">F1</th><th className="font-medium">PR-AUC</th></tr></thead>
            <tbody>
              {p.classifier.map((c) => (
                <tr key={c.model} className="border-t border-rule">
                  <td className="py-2">{c.model.replace("_", " ")}</td>
                  <td className="num">{c.recall.toFixed(2)}</td><td className="num">{c.precision.toFixed(2)}</td><td className="num">{c.F1.toFixed(2)}</td><td className="num">{c.PR_AUC ? c.PR_AUC.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section></div>
      </div>
    </>
  );
}
