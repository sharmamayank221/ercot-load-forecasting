"use client";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get, ZONES, fmt } from "@/lib/api";
import { PageTitle, Section, Field, ErrorNote, Loading, inputCls } from "@/components/ui";
import { TempScatter, Heatmap } from "@/components/charts";

type Load = { zone: string; points: { t: string; mw: number; temp_f: number }[] };
type Profile = { zone: string; heatmap: { month: number; hour: number; mw: number }[]; scatter: { temp_f: number; mw: number }[] };

export default function Explore() {
  const [zone, setZone] = useState("North Central");
  const [start, setStart] = useState("2026-07-13");
  const [end, setEnd] = useState("2026-07-27");
  const [load, setLoad] = useState<Load | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => { get<Load>("/api/load", { zone, start, end }).then(setLoad).catch((e) => setErr(e.message)); }, [zone, start, end]);
  useEffect(() => { setProf(null); get<Profile>("/api/profile", { zone }).then(setProf).catch((e) => setErr(e.message)); }, [zone]);

  const data = load?.points.map((p) => ({ ...p, label: p.t.slice(5, 16).replace("T", " ") })) ?? [];
  return (
    <>
      <PageTitle sub="Pick a zone and a window. Demand follows temperature closely in summer and inverts in winter, which is what the models learn.">Explore load and weather</PageTitle>
      <div className="flex flex-wrap gap-4">
        <Field label="Zone"><select className={inputCls} value={zone} onChange={(e) => setZone(e.target.value)}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
        <Field label="From"><input type="date" className={inputCls} value={start} min="2018-01-01" max="2026-11-04" onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={end} min="2018-01-01" max="2026-11-04" onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {err && <div className="mt-6"><ErrorNote error={err} /></div>}
      <Section title={`${zone}: load and temperature`} aside={`${data.length} hours`}>
        {!load ? <Loading /> : (
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ left: 8, right: 48, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={60} />
                <YAxis yAxisId="mw" tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                <YAxis yAxisId="t" orientation="right" tickLine={false} axisLine={false} fontSize={12} width={36} unit="°" domain={["auto", "auto"]} />
                <Tooltip formatter={(v, n) => [n === "load" ? `${fmt(Number(v))} MW` : `${Number(v).toFixed(0)}°F`, n]} />
                <Line yAxisId="mw" type="monotone" dataKey="mw" name="load" stroke="var(--sky)" strokeWidth={2.2} dot={false} animationDuration={600} />
                <Line yAxisId="t" type="monotone" dataKey="temp_f" name="temperature" stroke="var(--heat)" strokeWidth={1.5} dot={false} animationDuration={600} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>
      <div className="grid gap-x-10 md:grid-cols-2">
        <div><Section title="Summer load against temperature" aside="June to August, all years">{prof ? <TempScatter points={prof.scatter} /> : <Loading />}</Section></div>
        <div><Section title="The daily and seasonal shape" aside="all years">{prof ? <Heatmap cells={prof.heatmap} /> : <Loading />}</Section></div>
      </div>
    </>
  );
}
