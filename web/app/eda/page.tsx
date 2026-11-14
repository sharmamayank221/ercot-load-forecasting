"use client";
import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceArea, Cell } from "recharts";
import { get, fmt } from "@/lib/api";
import { PageTitle, Section, Stat, ErrorNote, Loading } from "@/components/ui";

type E = {
  facts: { rows: number; hours: number; zones: number; start: string; end: string; missing_temp_pct: number; archive_rows: number; api_rows: number; uri_hours: number };
  dist: { mw: number; hours: number }[]; monthly: { month: number; mean: number; p10: number; p90: number }[];
  profile: { hour: number; weekday: number; weekend: number }[]; response: { season: string; temp_f: number; mw: number }[];
  zone_growth: Record<string, number>[]; corr: { feature: string; r: number }[];
  uri: { t: string; mw: number; temp_f: number; shed: boolean }[];
  quality: { missing_hours: number; temp_outliers_fixed: number; archive_api_gap_pct: number; zones_missing_temp: Record<string, number> };
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ZONE_COLORS: Record<string, string> = { "North Central": "#1c5ba6", Coast: "#e6612a", "South Central": "#1f9e96", "Far West": "#8a5a2b", Southern: "#7b6cd9", East: "#9aa6b2", West: "#c9a227", North: "#d4668f" };
const corrName: Record<string, string> = { temp_f: "temperature", cdh: "cooling degree-hours", hdh: "heating degree-hours", dwpt: "dew point", rhum: "humidity", wspd: "wind speed", hour: "hour of day", dow: "day of week" };
const kFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

export default function EDA() {
  const [e, setE] = useState<E | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { get<E>("/api/eda").then(setE).catch((x) => setErr(x.message)); }, []);
  if (err) return <ErrorNote error={err} />;
  if (!e) return <Loading />;
  const resp = Object.values(e.response.reduce((acc, r) => { (acc[r.temp_f] ??= { temp_f: r.temp_f })[r.season] = r.mw; return acc; }, {} as Record<number, Record<string, number>>)).sort((a, b) => a.temp_f - b.temp_f);
  const uri = e.uri.map((p) => ({ ...p, label: p.t.slice(5, 13).replace("T", " ") }));
  const shedStart = uri.find((p) => p.shed)?.label, shedEnd = [...uri].reverse().find((p) => p.shed)?.label;
  const zones = Object.keys(e.zone_growth[0]).filter((k) => k !== "year");

  return (
    <>
      <PageTitle sub="What the data looks like before any modelling: how much there is, how demand is shaped by the clock, the calendar and the weather, and where the data is imperfect.">Exploring the data</PageTitle>

      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat label="Rows in the model table" value={fmt(e.facts.rows)} hint={`${fmt(e.facts.hours)} hours × ${e.facts.zones} zones`} />
        <Stat label="Coverage" value={`${e.facts.start.slice(0, 4)} to ${e.facts.end.slice(0, 4)}`} hint={`${e.facts.start} to ${e.facts.end}`} />
        <Stat label="From ERCOT archives" value={`${((e.facts.archive_rows / e.facts.rows) * 100).toFixed(1)}%`} hint="the rest from the live API" />
        <Stat label="Hours with no temperature" value={`${e.facts.missing_temp_pct.toFixed(2)}%`} hint="Tyler station, mostly" />
      </div>

      <Section title="How much power Texas uses in an hour" aside="distribution of system load, all hours">
        <div className="h-56">
          <ResponsiveContainer>
            <AreaChart data={e.dist} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" />
              <XAxis dataKey="mw" tickLine={false} axisLine={false} fontSize={12} tickFormatter={kFmt} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} />
              <Tooltip formatter={(v) => [`${fmt(Number(v))} hours`, "hours"]} labelFormatter={(v) => `about ${fmt(Number(v))} MW`} />
              <Area dataKey="hours" stroke="var(--sky)" fill="var(--sky)" fillOpacity={0.15} animationDuration={700} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 max-w-[70ch] text-[14px] text-muted">Two humps: a broad one for mild-weather hours around 40 to 50 GW, and a long summer tail stretching past 80 GW. The models have to be good at both.</p>
      </Section>

      <div className="grid gap-x-10 md:grid-cols-2">
        <div><Section title="The year has a shape" aside="monthly mean with the 10th to 90th percentile band">
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={e.monthly} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(m) => MONTHS[m - 1]} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} domain={["auto", "auto"]} />
                <Tooltip formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} labelFormatter={(m) => MONTHS[Number(m) - 1]} />
                <Area dataKey="p90" name="90th percentile" stroke="none" fill="var(--heat)" fillOpacity={0.12} animationDuration={700} />
                <Area dataKey="p10" name="10th percentile" stroke="none" fill="var(--paper)" fillOpacity={1} animationDuration={700} />
                <Line dataKey="mean" name="mean" stroke="var(--ink)" strokeWidth={2} dot={false} animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section></div>
        <div><Section title="Weekdays versus weekends" aside="summer hourly profile">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={e.profile} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(h) => `${h}:00`} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} domain={["auto", "auto"]} />
                <Tooltip formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} labelFormatter={(h) => `${h}:00`} />
                <Legend iconType="plainline" />
                <Line dataKey="weekday" stroke="var(--sky)" strokeWidth={2.2} dot={false} animationDuration={700} />
                <Line dataKey="weekend" stroke="var(--heat)" strokeWidth={2.2} dot={false} animationDuration={700} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section></div>
      </div>

      <Section title="Demand bends with temperature, in both directions" aside="mean system load by 5°F temperature bin at DFW">
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={resp} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid stroke="var(--rule)" />
              <XAxis dataKey="temp_f" type="number" tickLine={false} axisLine={false} fontSize={12} unit="°F" domain={["auto", "auto"]} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} domain={["auto", "auto"]} />
              <Tooltip formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} labelFormatter={(t) => `${t} to ${Number(t) + 5}°F`} />
              <Legend iconType="plainline" />
              <Line dataKey="summer" stroke="var(--heat)" strokeWidth={2.4} dot={{ r: 2 }} connectNulls animationDuration={700} />
              <Line dataKey="winter" stroke="var(--cool)" strokeWidth={2.4} dot={{ r: 2 }} connectNulls animationDuration={700} />
              <Line dataKey="spring/fall" stroke="var(--muted)" strokeWidth={1.8} dot={{ r: 2 }} connectNulls animationDuration={700} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 max-w-[70ch] text-[14px] text-muted">Load is lowest around 60 to 65°F and rises on either side: air conditioning to the right, electric heating to the left. This is why the features include cooling and heating degree-hours rather than raw temperature alone.</p>
      </Section>

      <div className="grid gap-x-10 md:grid-cols-2">
        <div><Section title="Which zones are growing" aside="average load by zone and year">
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={e.zone_growth} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} />
                <Tooltip formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                {zones.map((z) => <Line key={z} dataKey={z} stroke={ZONE_COLORS[z] ?? "var(--muted)"} strokeWidth={z === "Far West" ? 3 : 1.8} dot={false} animationDuration={700} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[14px] text-muted">Far West has more than doubled since 2018 (oil, gas and data-centre load), which is why the model predicts load relative to recent weeks rather than in raw MW.</p>
        </Section></div>
        <div><Section title="What correlates with load" aside="Pearson r, North Central, all hours">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={e.corr} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" domain={[-1, 1]} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis type="category" dataKey="feature" width={150} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(f) => corrName[f] ?? f} />
                <Tooltip formatter={(v) => Number(v).toFixed(2)} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Bar dataKey="r" radius={3} label={{ position: "right", fontSize: 11, formatter: (v: unknown) => Number(v).toFixed(2) }}>
                  {e.corr.map((c) => <Cell key={c.feature} fill={c.r >= 0 ? "var(--heat)" : "var(--cool)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[14px] text-muted">Raw temperature correlates only moderately because the relationship is U-shaped; cooling degree-hours capture the summer side much better.</p>
        </Section></div>
      </div>

      <Section title="Winter Storm Uri, February 2021" aside="why one week is excluded from training">
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={uri} margin={{ left: 8, right: 48, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={50} />
              <YAxis yAxisId="mw" tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} domain={["auto", "auto"]} />
              <YAxis yAxisId="t" orientation="right" tickLine={false} axisLine={false} fontSize={12} width={36} unit="°" domain={["auto", "auto"]} />
              <Tooltip formatter={(v, n) => [n === "load" ? `${fmt(Number(v))} MW` : `${Number(v).toFixed(0)}°F`, n]} />
              {shedStart && shedEnd && <ReferenceArea yAxisId="mw" x1={shedStart} x2={shedEnd} fill="var(--heat)" fillOpacity={0.08} label={{ value: "rolling outages", position: "insideTop", fontSize: 12, fill: "var(--heat)" }} />}
              <Line yAxisId="mw" dataKey="mw" name="load" stroke="var(--sky)" strokeWidth={2.2} dot={false} animationDuration={700} />
              <Line yAxisId="t" dataKey="temp_f" name="temperature" stroke="var(--cool)" strokeWidth={1.5} dot={false} animationDuration={700} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 max-w-[70ch] text-[14px] text-muted">Temperature fell below 0°F and demand should have set records, but recorded load dropped because the grid shed load to avoid collapse. Those {e.facts.uri_hours} hours record what was served, not what was needed, so they are flagged and left out of training.</p>
      </Section>

      <Section title="Data quality, in short">
        <dl className="grid gap-x-10 gap-y-3 text-[14px] md:grid-cols-2">
          <div className="flex justify-between border-b border-rule pb-2"><dt className="text-muted">Hours missing from the load series</dt><dd className="num font-semibold">{e.quality.missing_hours} (one day in Oct 2026, plus spring clock changes)</dd></div>
          <div className="flex justify-between border-b border-rule pb-2"><dt className="text-muted">Impossible temperature readings removed</dt><dd className="num font-semibold">{e.quality.temp_outliers_fixed} (Abilene, April 2022, up to 129°F overnight)</dd></div>
          <div className="flex justify-between border-b border-rule pb-2"><dt className="text-muted">API versus settled archive load</dt><dd className="num font-semibold">API runs {e.quality.archive_api_gap_pct}% higher; archive used where it exists</dd></div>
          <div className="flex justify-between border-b border-rule pb-2"><dt className="text-muted">Stations with temperature gaps</dt><dd className="num font-semibold">{Object.entries(e.quality.zones_missing_temp).map(([z, n]) => `${z} ${n} h`).join(", ")}</dd></div>
        </dl>
      </Section>
    </>
  );
}
