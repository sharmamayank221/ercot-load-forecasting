"use client";
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { loadJSON, fmt } from "@/lib/api";
import { PageTitle, Section, Stat, ErrorNote, Loading } from "@/components/ui";
import { ZONE_PROFILES } from "@/lib/tsResults";

type TS = {
  acf: { lags: number[]; log_level: number[]; lag24_diff: number[]; reg_lag24_diff: number[] };
  decomposition: { window: string; fit: string; t: string[]; observed: (number | null)[]; trend: (number | null)[]; seasonal: (number | null)[]; remainder: (number | null)[];
    seasonal_day_utc: number[]; additive_range_mw: [number, number]; multiplicative_range: [number, number] };
};
const kFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

function Panel({ data, k, color, label, zero }: { data: Record<string, unknown>[]; k: string; color: string; label: string; zero?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="h-28">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: 0, right: 12, top: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis dataKey="label" hide />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} tickFormatter={(v) => (Math.abs(v) >= 1000 ? kFmt(v) : String(v))} domain={["auto", "auto"]} />
            <Tooltip formatter={(v) => [`${fmt(Number(v))} MW`, label]} labelFormatter={(l) => String(l)} />
            {zero && <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 3" />}
            <Line dataKey={k} stroke={color} strokeWidth={1.6} dot={false} connectNulls={false} animationDuration={700} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Structure() {
  const [d, setD] = useState<TS | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { loadJSON<TS>("ts_structure.json").then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorNote error={err} />;
  if (!d) return <Loading />;
  const dec = d.decomposition;
  const rows = dec.t.map((t, i) => ({ label: t.replace("T", " "), observed: dec.observed[i], trend: dec.trend[i], seasonal: dec.seasonal[i], remainder: dec.remainder[i] }));
  const acf = d.acf.lags.map((l, i) => ({ lag: l, "log level": d.acf.log_level[i], "lag-24 difference": d.acf.lag24_diff[i], "regular + lag-24": d.acf.reg_lag24_diff[i] }));
  const day = dec.seasonal_day_utc.map((v, h) => ({ hour: h, effect: v }));

  return (
    <>
      <PageTitle sub="How the system series is built: a long-run trend, a strong daily cycle, weekly structure, and variability that grows with the level. These properties decide the transform, the differencing and the models.">Time-series structure</PageTitle>

      <Section title="Trend, seasonal and remainder components" aside={`additive, period 24 · fitted ${dec.fit.split(",")[0]} · shown ${dec.window}`}>
        <div className="grid gap-x-10 md:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-2">
            <Panel data={rows} k="observed" color="var(--ink)" label="Observed" />
            <Panel data={rows} k="trend" color="var(--sky)" label="Trend-cycle (centred moving average)" />
            <Panel data={rows} k="seasonal" color="var(--heat)" label="Daily seasonal effect" zero />
            <Panel data={rows} k="remainder" color="var(--muted)" label="Remainder" zero />
          </div>
          <div className="flex flex-col gap-6 pt-2">
            <Stat label="Additive daily effect" value={`${fmt(dec.additive_range_mw[0])} to +${fmt(dec.additive_range_mw[1])}`} hint="MW, across the 24 hours" accent />
            <Stat label="Multiplicative daily index" value={`${dec.multiplicative_range[0]} to ${dec.multiplicative_range[1]}`} hint="averages 1" />
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">One day of the seasonal effect (UTC hour)</div>
              <div className="h-32">
                <ResponsiveContainer>
                  <BarChart data={day} margin={{ left: 0, right: 4 }}>
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={10} interval={5} />
                    <YAxis hide domain={["auto", "auto"]} />
                    <ReferenceLine y={0} stroke="var(--muted)" />
                    <Tooltip formatter={(v) => `${fmt(Number(v))} MW`} labelFormatter={(h) => `${h}:00 UTC`} />
                    <Bar dataKey="effect" fill="var(--heat)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-muted">Centred smoothers are descriptive, not forecast inputs. Seasonal adjustment removes the recurring cycle; it does not remove the trend or prove stationarity.</p>
          </div>
        </div>
      </Section>

      <Section title="A strong daily cycle shapes the models" aside="ACF of system log load, training 2018–2023">
        <div className="grid gap-x-10 md:grid-cols-[1fr_300px]">
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={acf} margin={{ left: 0, right: 16, top: 24 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="lag" type="number" domain={[1, 192]} ticks={[24, 48, 72, 96, 120, 144, 168, 192]} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(h) => `${h}h`} />
                <YAxis domain={[-0.4, 1]} ticks={[-0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]} tickLine={false} axisLine={false} fontSize={12} width={36} />
                <Tooltip formatter={(v, n) => [Number(v).toFixed(3), n]} labelFormatter={(h) => `lag ${h} h`} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <ReferenceLine x={24} stroke="var(--heat)" strokeDasharray="3 3" label={{ value: "24 h", position: "top", fontSize: 11, fill: "var(--heat)" }} />
                <ReferenceLine x={168} stroke="var(--heat)" strokeDasharray="3 3" label={{ value: "168 h", position: "top", fontSize: 11, fill: "var(--heat)" }} />
                <Line dataKey="log level" stroke="var(--ink)" strokeWidth={2} dot={false} animationDuration={800} />
                <Line dataKey="lag-24 difference" stroke="var(--heat)" strokeWidth={2.2} dot={false} animationDuration={800} />
                <Line dataKey="regular + lag-24" stroke="var(--cool)" strokeWidth={1.6} dot={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-6 pt-2">
            <Stat label="ACF at lag 24" value={`${d.acf.log_level[23].toFixed(3)} → ${d.acf.lag24_diff[23].toFixed(3)}`} hint="before and after seasonal (lag-24) differencing" accent />
            <Stat label="ACF at lag 168 after differencing" value={d.acf.lag24_diff[167].toFixed(3)} hint="weekly structure remains" />
            <p className="text-[13px] leading-relaxed text-muted">log(load) is modelled because the variance grows with the level; forecasts are scored back in MW. The regular-plus-seasonal difference was not adopted by default.</p>
          </div>
        </div>
      </Section>

      <Section title="Eight zones, eight different profiles" aside="whole-series features; ACF is of log load">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="text-left text-muted"><tr>
              <th className="py-2 font-medium">Zone</th><th className="font-medium">Mean MW</th><th className="font-medium">CV</th><th className="font-medium">ACF 24</th>
              <th className="font-medium">ACF 168</th><th className="font-medium">Trend strength</th><th className="font-medium">Daily seasonal strength</th></tr></thead>
            <tbody>
              {ZONE_PROFILES.map((z) => {
                const far = z.zone === "Far West";
                return (
                  <tr key={z.zone} className="border-t border-rule" style={far ? { background: "var(--heat-soft)" } : undefined}>
                    <td className="py-2 pr-4 font-semibold">{z.zone}</td><td className="num">{fmt(z.mean, 1)}</td><td className="num">{z.cv.toFixed(3)}</td>
                    <td className="num">{z.acf24.toFixed(3)}</td><td className="num">{z.acf168.toFixed(3)}</td><td className="num">{z.trend.toFixed(3)}</td>
                    <td className="num">
                      <span className="mr-2 inline-block h-2 rounded-full align-middle" style={{ width: `${z.seas * 90}px`, background: far ? "var(--heat)" : "var(--sky)" }} />{z.seas.toFixed(3)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-[80ch] text-[14px] text-muted">Far West stands out: the most persistent (ACF 0.993 at 24 h, 0.978 at 168 h) with the weakest daily seasonality (0.351), consistent with steady industrial load. Trend and seasonal strength are descriptive summaries, not predictive scores.</p>
      </Section>

      <Section title="Zone links: explored, not modelled" aside="training data, lag-24-differenced log load">
        <div className="flex flex-wrap items-center gap-10">
          <Stat label="Strongest cross-correlation" value="0.867" hint="North leading North Central by one hour" accent />
          <p className="max-w-[60ch] text-[14px] leading-relaxed text-muted">A temporal association only: it is not causal and showed no forecast gain, so it did not justify a pooled or joint multi-zone model. LSTM and joint forecasting were a documented no-go made before the final test was opened.</p>
        </div>
      </Section>
    </>
  );
}
