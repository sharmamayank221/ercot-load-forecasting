"use client";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import { PageTitle, Stat, Section, ErrorNote, Loading } from "@/components/ui";
import LoadRibbon from "@/components/LoadRibbon";
import { METHODS, MODEL_COLOR } from "@/lib/tsResults";

type Summary = { start: string; end: string; latest_day: { date: string; points: { hour: number; mw: number; temp_f: number }[] } };

const SPLIT = [
  { name: "Training", when: "2018–2023", note: "Fit, log transform, λ search", flex: 6, bg: "var(--sky)", fg: "#f6f7f4" },
  { name: "Validation", when: "2024–2025 · 731 origins", note: "Choose SARIMA form and Ridge λ", flex: 2, bg: "var(--heat)", fg: "#13202e" },
  { name: "Final test", when: "Jan 1 – Oct 29, 2026 · 302 origins", note: "Scored once, everything frozen", flex: 1.8, bg: "var(--ink)", fg: "#f6f7f4" },
];

export default function Overview() {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { get<Summary>("/api/summary").then(setS).catch((e) => setErr(e.message)); }, []);

  return (
    <>
      <PageTitle sub="ASDS 5306 Applied Time Series Analysis · Group 3: Bikesh Adhikari, Charan Reddy, Mayanka Sharma. Classical time-series models against a Ridge regression, for ERCOT's system load and eight weather zones.">
        Forecasting ERCOT load 24 hours ahead
      </PageTitle>
      {err ? <ErrorNote error={err} /> : !s ? <Loading /> : <LoadRibbon points={s.latest_day.points} date={s.latest_day.date} />}

      <div className="mt-10 grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat label="Series" value="9" hint="system + 8 weather zones" />
        <Stat label="Forecast horizon" value="24 h" hint="from a midnight origin" />
        <Stat label="Final-test origins" value="302" hint="Jan 1 – Oct 29, 2026" />
        <Stat label="Ridge vs previous-day naive" value="−18.3%" hint="system RMSE, final test" accent />
      </div>

      <Section title="Research question">
        <p className="max-w-[80ch] text-[17px] leading-relaxed">
          Do course-aligned time-series models or a Ridge regression improve 24-hour ERCOT load forecasts over seasonal-naive
          references, and does that vary by zone, forecast lead, season, or high load?
        </p>
        <p className="mt-3 max-w-[80ch] text-[14px] text-muted">
          Inputs are observed load through the origin plus calendar terms, with no future weather. LSTM and a joint multi-zone
          model were a documented no-go before the test; trees are out of scope.
        </p>
      </Section>

      <Section title="A chronological split with a frozen test" aside="never shuffled">
        <div className="flex gap-1.5">
          {SPLIT.map((b, i) => (
            <div key={b.name} className={`px-5 py-4 ${i === 0 ? "rounded-l-lg" : ""} ${i === SPLIT.length - 1 ? "rounded-r-lg" : ""}`} style={{ flex: b.flex, background: b.bg, color: b.fg }}>
              <div className="text-[15px] font-bold">{b.name}</div>
              <div className="text-[13px] opacity-90">{b.when}</div>
              <div className="mt-1 text-[12px] opacity-80">{b.note}</div>
            </div>
          ))}
        </div>
        <ul className="mt-4 grid gap-x-10 gap-y-1.5 text-[14px] text-muted md:grid-cols-2">
          <li>Forecasts issued at 00:00 America/Chicago; last input is the preceding hour</li>
          <li>Targets: the next 24 UTC hours</li>
          <li>Test coefficients frozen after fitting through Dec 31, 2025</li>
          <li>Scaling and λ chosen on training and validation only</li>
          <li>No realised weather for the target day</li>
          <li>High load = training 90th percentile (system 61,884.7 MW)</li>
        </ul>
      </Section>

      <Section title="Five methods, one matched comparison" aside="all scored on identical target hours">
        <div className="grid gap-4 md:grid-cols-5">
          {METHODS.map((m) => (
            <div key={m.name} className="rounded-lg border border-rule bg-panel p-4" style={{ borderTop: `4px solid ${MODEL_COLOR[m.name]}` }}>
              <div className="text-[15px] font-bold">{m.name}</div>
              <div className="mt-1 text-[13px] leading-snug text-muted">{m.what}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
