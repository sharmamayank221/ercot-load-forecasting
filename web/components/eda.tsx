"use client";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { motion } from "framer-motion";
import { fmt } from "@/lib/api";

const kFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

/** Hour of day -> colour: night in sky blue, the 4 pm peak in heat orange. */
export function hourColor(h: number) {
  const x = (1 + Math.cos((2 * Math.PI * (h - 16)) / 24)) / 2;
  const a = [28, 91, 166], b = [230, 97, 42];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * x)).join(",")})`;
}

export type ZoneBox = { zone: string; p0: number; p5: number; p25: number; p50: number; p75: number; p95: number; p100: number; growth_pct: number; temp_min: number; temp_max: number };

/** Horizontal box plot: whiskers 5th–95th percentile, box 25th–75th, tick at median, dot at the maximum. */
export function ZoneBoxes({ rows }: { rows: ZoneBox[] }) {
  const sorted = [...rows].sort((a, b) => b.p50 - a.p50);
  const hi = Math.max(...rows.map((r) => r.p100)) * 1.02;
  const x = (v: number) => `${(v / hi) * 100}%`;
  return (
    <div>
      <div className="grid gap-y-3" style={{ gridTemplateColumns: "120px 1fr 72px" }}>
        {sorted.map((r, i) => (
          <div key={r.zone} className="contents">
            <div className="text-[13px] leading-6">{r.zone}</div>
            <div className="relative h-6" title={`median ${fmt(r.p50)} MW, middle half ${fmt(r.p25)} to ${fmt(r.p75)} MW, max ${fmt(r.p100)} MW`}>
              <div className="absolute top-1/2 h-px bg-muted" style={{ left: x(r.p5), width: `calc(${x(r.p95)} - ${x(r.p5)})` }} />
              <motion.div className="absolute top-1 bottom-1 rounded-sm bg-sky/20 border border-sky"
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.05, duration: 0.5 }}
                style={{ left: x(r.p25), width: `calc(${x(r.p75)} - ${x(r.p25)})`, transformOrigin: "left" }} />
              <div className="absolute top-0.5 bottom-0.5 w-[2px] bg-ink" style={{ left: x(r.p50) }} />
              <div className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-heat" style={{ left: x(r.p100) }} />
            </div>
            <div className="num text-right text-[13px] font-semibold" style={{ color: r.growth_pct > 50 ? "var(--heat)" : "var(--ink)" }}>
              {r.growth_pct > 0 ? "+" : ""}{r.growth_pct.toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        <span>box: middle half of hours</span><span>line: 5th to 95th percentile</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-heat align-middle" /> highest hour</span>
        <span>right: change in average load, 2018 to 2026</span>
      </div>
    </div>
  );
}

const LABEL: Record<string, string> = { load_mw: "load", temp_f: "temp", cdh: "CDH", hdh: "HDH", dwpt: "dew pt", rhum: "humidity", wspd: "wind", prcp: "rain", hour: "hour", dow: "weekday", month: "month" };

/** Correlation matrix as a coloured grid: orange positive, teal negative. */
export function CorrMatrix({ cols, r }: { cols: string[]; r: number[][] }) {
  const cell = (v: number) => {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(230,97,42,${a * 0.9})` : `rgba(31,158,150,${a * 0.9})`;
  };
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `64px repeat(${cols.length}, 36px)` }}>
        <div />
        {cols.map((c) => <div key={c} className="h-14 origin-bottom-left translate-x-4 -rotate-45 self-end whitespace-nowrap text-[11px] text-muted">{LABEL[c] ?? c}</div>)}
        {r.map((row, i) => (
          <div key={cols[i]} className="contents">
            <div className="pr-2 text-right text-[11px] leading-9 text-muted">{LABEL[cols[i]] ?? cols[i]}</div>
            {row.map((v, j) => (
              <motion.div key={j} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: (i + j) * 0.012 }}
                title={`${LABEL[cols[i]]} × ${LABEL[cols[j]]}: r = ${v.toFixed(2)}`}
                className="num flex h-9 items-center justify-center rounded-[3px] text-[10px]"
                style={{ background: i === j ? "var(--rule)" : cell(v), color: Math.abs(v) > 0.55 && i !== j ? "white" : "var(--ink)" }}>
                {i === j ? "" : v.toFixed(2).replace("0.", ".").replace("-.", "−.")}
              </motion.div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[12px] text-muted">CDH and HDH are cooling and heating degree-hours (temperature above or below 65°F).</div>
    </div>
  );
}

/** Autocorrelation of system load with markers at the lags the model uses. */
export function ACFChart({ data }: { data: { lag: number; r: number }[] }) {
  const at = (k: number) => data.find((d) => d.lag === k)?.r ?? 0;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 24, top: 16 }}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey="lag" type="number" domain={[1, 192]} ticks={[24, 48, 72, 96, 120, 144, 168, 192]} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(h) => `${h / 24}d`} />
          <YAxis domain={[-0.2, 1]} tickLine={false} axisLine={false} fontSize={12} width={36} />
          <Tooltip formatter={(v) => Number(v).toFixed(3)} labelFormatter={(h) => `${h} hours earlier`} />
          {[24, 48, 168].map((k) => (
            <ReferenceLine key={k} x={k} stroke={k === 24 ? "var(--muted)" : "var(--heat)"} strokeDasharray="3 3"
              label={{ value: `${k} h: r ${at(k).toFixed(2)}`, position: "top", fontSize: 11, fill: k === 24 ? "var(--muted)" : "var(--heat)" }} />
          ))}
          <Line dataKey="r" stroke="var(--sky)" strokeWidth={2} dot={false} animationDuration={900} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Summer hours: load against temperature, each point coloured by hour of day. */
export function HourScatter({ points }: { points: { temp_f: number; mw: number; hour: number }[] }) {
  return (
    <div>
      <div className="h-72">
        <ResponsiveContainer>
          <ScatterChart margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="var(--rule)" />
            <XAxis dataKey="temp_f" name="temperature" unit="°F" type="number" tickLine={false} axisLine={false} fontSize={12} domain={["auto", "auto"]} />
            <YAxis dataKey="mw" name="load" type="number" tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} domain={["auto", "auto"]} />
            <ZAxis range={[10, 10]} />
            <Tooltip formatter={(v, n) => [n === "load" ? `${fmt(Number(v))} MW` : `${v}°F`, n]} />
            <Scatter data={points} isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: { hour: number } }) => <circle cx={p.cx} cy={p.cy} r={2.4} fill={hourColor(p.payload?.hour ?? 0)} opacity={0.5} />} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        hour of day
        {[0, 4, 8, 12, 16, 20].map((h) => <span key={h} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: hourColor(h) }} />{h}:00</span>)}
      </div>
    </div>
  );
}

/** One week of system load with temperature on a second axis. */
export function WeekChart({ points, shade }: { points: { t: string; mw: number; temp_f: number; shed?: boolean }[]; shade?: boolean }) {
  const data = points.map((p) => ({ ...p, label: p.t.slice(5, 13).replace("T", " ") }));
  const peak = data.reduce((a, b) => (b.mw > a.mw ? b : a), data[0]);
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 40, top: 18 }}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={50} />
          <YAxis yAxisId="mw" tickLine={false} axisLine={false} fontSize={12} width={40} tickFormatter={kFmt} domain={["auto", "auto"]} />
          <YAxis yAxisId="t" orientation="right" tickLine={false} axisLine={false} fontSize={12} width={32} unit="°" domain={["auto", "auto"]} />
          <Tooltip formatter={(v, n) => [n === "load" ? `${fmt(Number(v))} MW` : `${Number(v).toFixed(0)}°F`, n]} />
          {!shade && <ReferenceLine yAxisId="mw" y={peak.mw} stroke="var(--heat)" strokeDasharray="3 3" label={{ value: `record ${fmt(peak.mw)} MW`, position: "insideTopLeft", fontSize: 11, fill: "var(--heat)" }} />}
          <Line yAxisId="mw" dataKey="mw" name="load" stroke="var(--sky)" strokeWidth={2.2} dot={false} animationDuration={800} />
          <Line yAxisId="t" dataKey="temp_f" name="temperature" stroke={shade ? "var(--cool)" : "var(--heat)"} strokeWidth={1.4} dot={false} animationDuration={800} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
