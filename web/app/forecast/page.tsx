"use client";
import { useEffect, useState } from "react";
import { get, ZONES, fmt } from "@/lib/api";
import { PageTitle, Section, Field, Stat, ErrorNote, Loading, inputCls } from "@/components/ui";
import { HourlyLines } from "@/components/charts";

type F = {
  zone: string; date: string; model: string; peak_mw: number; peak_hour: number; mean_mw: number; hourly_mw: number[];
  actual_mw: number[]; naive_mw: number[]; temp_f: number[]; actual_peak_mw?: number; mape_pct?: number;
  weather: { temp_high_f: number; temp_low_f: number; humidity_mean_pct: number };
  explain: { top_features: [string, number][]; inputs: Record<string, number | boolean> };
};

export default function Forecast() {
  const [zone, setZone] = useState("North Central");
  const [date, setDate] = useState("2026-07-22");
  const [f, setF] = useState<F | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setErr(""); get<F>("/api/forecast", { zone, date }).then(setF).catch((e) => setErr(e.message)); }, [zone, date]);

  const miss = f && f.actual_peak_mw ? f.peak_mw - f.actual_peak_mw : 0;
  return (
    <>
      <PageTitle sub="The model only sees what was known the day before: the weather, the calendar, and load from two and seven days earlier.">Day-ahead forecast against what happened</PageTitle>
      <div className="flex flex-wrap gap-4">
        <Field label="Zone"><select className={inputCls} value={zone} onChange={(e) => setZone(e.target.value)}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
        <Field label="Date"><input type="date" className={inputCls} value={date} min="2025-01-01" max="2026-11-04" onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {err && <div className="mt-6"><ErrorNote error={err} /></div>}
      {!f ? <div className="mt-8"><Loading /></div> : (
        <>
          <Section title={`${f.zone}, ${f.date}`} aside={`model: ${f.model}`}>
            <HourlyLines series={[
              { key: "actual", name: "actual", color: "var(--ink)", width: 3, values: f.actual_mw },
              { key: "forecast", name: "forecast", color: "var(--heat)", values: f.hourly_mw },
              { key: "naive", name: "same hour last week", color: "var(--muted)", dash: "4 4", width: 1.5, values: f.naive_mw },
            ]} />
          </Section>
          <div className="mt-8 grid grid-cols-2 gap-8 md:grid-cols-4">
            <Stat label="Forecast peak" value={`${fmt(f.peak_mw)} MW`} hint={`at ${f.peak_hour}:00`} accent />
            <Stat label="Actual peak" value={f.actual_peak_mw ? `${fmt(f.actual_peak_mw)} MW` : "n/a"} hint={miss ? `${miss > 0 ? "+" : ""}${fmt(miss)} MW forecast ${miss > 0 ? "over" : "under"}` : undefined} />
            <Stat label="Error for the day" value={f.mape_pct != null ? `${f.mape_pct.toFixed(2)}%` : "n/a"} hint="mean absolute % error" />
            <Stat label="Temperature" value={`${f.weather.temp_high_f.toFixed(0)}° / ${f.weather.temp_low_f.toFixed(0)}°`} hint={`${f.weather.humidity_mean_pct}% humidity`} />
          </div>
          <Section title="What drove this forecast" aside="feature importance of the model, and the day's inputs">
            <div className="grid gap-8 md:grid-cols-2">
              <ul className="flex flex-col gap-2">
                {f.explain.top_features.map(([name, v]) => (
                  <li key={name} className="flex items-center gap-3 text-[14px]">
                    <span className="w-44 shrink-0 text-muted">{name}</span>
                    <span className="h-2 rounded-full bg-sky" style={{ width: `${Math.max(2, v * 400)}px` }} />
                    <span className="num text-[12px] text-muted">{(v * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-y-2 text-[14px]">
                {Object.entries(f.explain.inputs).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted">{k.replace(/_/g, " ")}</dt><dd className="num font-semibold">{typeof v === "number" ? fmt(v, 1) : v ? "yes" : "no"}</dd></div>
                ))}
              </dl>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
