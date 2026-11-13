"use client";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get, ZONES, fmt } from "@/lib/api";
import { PageTitle, Section, Field, Stat, ErrorNote, Loading, inputCls } from "@/components/ui";
import { HourlyLines } from "@/components/charts";

type W = { zone: string; date: string; temp_shift_f: number; base_mw: number[]; shifted_mw: number[]; peak_base: number; peak_shifted: number; curve: { shift: number; peak_mw: number }[] };

export default function WhatIf() {
  const [zone, setZone] = useState("Coast");
  const [date, setDate] = useState("2026-08-15");
  const [shift, setShift] = useState(5);
  const [w, setW] = useState<W | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const id = setTimeout(() => { setErr(""); get<W>("/api/whatif", { zone, date, temp_shift_f: shift }).then(setW).catch((e) => setErr(e.message)); }, 150);
    return () => clearTimeout(id);
  }, [zone, date, shift]);

  const d = w ? w.peak_shifted - w.peak_base : 0;
  return (
    <>
      <PageTitle sub="Drag the slider to re-run the forecast with every hour of the day warmer or cooler. The model re-computes degree-hours and the 24- and 72-hour temperature history.">If tomorrow is hotter than forecast</PageTitle>
      <div className="flex flex-wrap items-end gap-6">
        <Field label="Zone"><select className={inputCls} value={zone} onChange={(e) => setZone(e.target.value)}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
        <Field label="Date"><input type="date" className={inputCls} value={date} min="2018-01-08" max="2026-11-04" onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={`Temperature shift: ${shift > 0 ? "+" : ""}${shift}°F`}>
          <input type="range" min={-15} max={15} step={1} value={shift} onChange={(e) => setShift(Number(e.target.value))} className="w-64" aria-label="temperature shift" />
        </Field>
      </div>
      {err && <div className="mt-6"><ErrorNote error={err} /></div>}
      {!w ? <div className="mt-8"><Loading /></div> : (
        <>
          <Section title={`${w.zone}, ${w.date}`}>
            <HourlyLines series={[
              { key: "base", name: "forecast as observed", color: "var(--sky)", values: w.base_mw },
              { key: "alt", name: `forecast at ${shift > 0 ? "+" : ""}${shift}°F`, color: "var(--heat)", width: 3, values: w.shifted_mw },
            ]} />
          </Section>
          <div className="mt-8 grid grid-cols-3 gap-8">
            <Stat label="Peak, as observed" value={`${fmt(w.peak_base)} MW`} />
            <Stat label={`Peak at ${shift > 0 ? "+" : ""}${shift}°F`} value={`${fmt(w.peak_shifted)} MW`} hint={`${d > 0 ? "+" : ""}${fmt(d)} MW, ${d > 0 ? "+" : ""}${((d / w.peak_base) * 100).toFixed(1)}%`} accent />
            <Stat label="Per degree" value={`${fmt(Math.abs(d / (shift || 1)))} MW`} hint="at this shift" />
          </div>
          <Section title="How the peak responds to temperature" aside="forecast peak for shifts of −15 to +15°F">
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={w.curve} margin={{ left: 8, right: 16, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis dataKey="shift" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}°`} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v) => `${fmt(Number(v))} MW`} labelFormatter={(v) => `${Number(v) > 0 ? "+" : ""}${v}°F`} />
                  <Line type="monotone" dataKey="peak_mw" stroke="var(--ink)" strokeWidth={2} dot={{ r: 3 }} animationDuration={500} />
                  <ReferenceDot x={shift} y={w.peak_shifted} r={7} fill="var(--heat)" stroke="white" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
