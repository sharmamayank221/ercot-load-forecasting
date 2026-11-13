"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Scatter, ScatterChart, ZAxis } from "recharts";
import { fmt, tempColor } from "@/lib/api";

export function HourlyLines({ series, height = 320 }: {
  series: { key: string; name: string; color: string; dash?: string; width?: number; values: number[] }[]; height?: number;
}) {
  const data = Array.from({ length: 24 }, (_, h) => Object.fromEntries([["hour", h], ...series.map((s) => [s.key, s.values[h]])]));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(h) => `${h}:00`} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
          <Tooltip formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} labelFormatter={(h) => `${h}:00`} />
          <Legend iconType="plainline" />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash} dot={false} isAnimationActive animationDuration={700} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TempScatter({ points }: { points: { temp_f: number; mw: number }[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <ScatterChart margin={{ left: 8, right: 16, top: 8 }}>
          <CartesianGrid stroke="var(--rule)" />
          <XAxis dataKey="temp_f" name="temperature" unit="°F" type="number" tickLine={false} axisLine={false} fontSize={12} domain={["auto", "auto"]} />
          <YAxis dataKey="mw" name="load" type="number" tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
          <ZAxis range={[10, 10]} />
          <Tooltip formatter={(v, n) => [n === "load" ? `${fmt(Number(v))} MW` : `${v}°F`, n]} />
          <Scatter data={points} fill="var(--sky)" fillOpacity={0.25} isAnimationActive={false} shape={(p: { cx?: number; cy?: number; payload?: { temp_f: number } }) => <circle cx={p.cx} cy={p.cy} r={2.2} fill={tempColor(p.payload?.temp_f ?? 60)} opacity={0.35} />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function Heatmap({ cells }: { cells: { month: number; hour: number; mw: number }[] }) {
  const lo = Math.min(...cells.map((c) => c.mw)), hi = Math.max(...cells.map((c) => c.mw));
  const shade = (v: number) => { const x = (v - lo) / (hi - lo); return `rgba(230,97,42,${0.08 + x * 0.9})`; };
  return (
    <div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: "36px repeat(24, 1fr)" }}>
        {MONTHS.map((m, mi) => (
          <div key={m} className="contents">
            <div className="pr-2 text-right text-[11px] leading-[18px] text-muted">{m}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const c = cells.find((x) => x.month === mi + 1 && x.hour === h);
              return <div key={h} title={c ? `${m} ${h}:00, ${fmt(c.mw)} MW` : ""} className="h-[18px] rounded-[2px]" style={{ background: c ? shade(c.mw) : "transparent" }} />;
            })}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[10px] text-muted">{h % 6 === 0 ? h : ""}</div>)}
      </div>
      <div className="mt-2 text-[12px] text-muted">Average load by month and hour of day. Darker is higher, from {fmt(lo)} to {fmt(hi)} MW.</div>
    </div>
  );
}
