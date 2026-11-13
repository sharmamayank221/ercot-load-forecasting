"use client";
import { motion, useReducedMotion } from "framer-motion";
import { tempColor, fmt } from "@/lib/api";

type Pt = { hour: number; mw: number; temp_f: number };

/** The hero: the latest day's system load drawn as a ribbon whose colour follows temperature. */
export default function LoadRibbon({ points, date }: { points: Pt[]; date: string }) {
  const reduce = useReducedMotion();
  const W = 1000, H = 300, padL = 56, padR = 16, padT = 18, padB = 34;
  const ys = points.map((p) => p.mw);
  const lo = Math.min(...ys) * 0.97, hi = Math.max(...ys) * 1.02;
  const x = (h: number) => padL + (h / 23) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.hour).toFixed(1)} ${y(p.mw).toFixed(1)}`).join(" ");
  const area = `${d} L${x(23).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`;
  const peak = points.reduce((a, b) => (b.mw > a.mw ? b : a), points[0]);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v / 1000) * 1000);

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`System load on ${date}, coloured by temperature`}>
        <defs>
          <linearGradient id="ribbon" x1="0" x2="1" y1="0" y2="0">
            {points.map((p) => <stop key={p.hour} offset={`${(p.hour / 23) * 100}%`} stopColor={tempColor(p.temp_f)} />)}
          </linearGradient>
          <linearGradient id="fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#13202e" stopOpacity="0.10" /><stop offset="100%" stopColor="#13202e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeDasharray="2 4" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{fmt(v / 1000)}k</text>
          </g>
        ))}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={x(h)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--muted)">{h === 0 ? "midnight" : h === 12 ? "noon" : `${h}:00`}</text>
        ))}
        <motion.path d={area} fill="url(#fade)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.6 }} />
        <motion.path d={d} fill="none" stroke="url(#ribbon)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeInOut" }} />
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}>
          <circle cx={x(peak.hour)} cy={y(peak.mw)} r="6" fill={tempColor(peak.temp_f)} stroke="white" strokeWidth="2" />
          <text x={x(peak.hour) + (peak.hour > 16 ? -10 : 10)} y={y(peak.mw) - 12} textAnchor={peak.hour > 16 ? "end" : "start"} fontSize="13" fontWeight="700" fill="var(--ink)">
            peak {fmt(peak.mw)} MW at {peak.temp_f.toFixed(0)}°F
          </text>
        </motion.g>
      </svg>
      <figcaption className="mt-1 flex items-center gap-3 text-[13px] text-muted">
        <span>System load on {date}, hour by hour.</span>
        <span className="inline-flex items-center gap-1">colour = temperature
          <span className="ml-1 inline-block h-2 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${tempColor(40)}, ${tempColor(100)})` }} />
          <span>40 to 100°F</span>
        </span>
      </figcaption>
    </figure>
  );
}
