"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/api";
import { PageTitle, Section, Stat } from "@/components/ui";
import { ARMA, HOLT_WINTERS, LEADS, MODEL_COLOR, MODELS, PEAK_BIAS, SARIMA_FORMS, SEASONS, TEST, VALIDATION_RMSE, ZONES_TEST } from "@/lib/tsResults";

const kFmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
const rmseBars = (src: Record<string, number>) => MODELS.map((m) => ({ model: m, rmse: src[m] }));

function RmseChart({ data, title }: { data: { model: string; rmse: number }[]; title: string }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold text-muted">{title}</div>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 48 }}>
            <XAxis type="number" hide domain={[0, 7000]} />
            <YAxis type="category" dataKey="model" width={100} tickLine={false} axisLine={false} fontSize={13} />
            <Tooltip formatter={(v) => `${fmt(Number(v), 1)} MW`} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
            <Bar dataKey="rmse" radius={[0, 3, 3, 0]} animationDuration={800} label={{ position: "right", fontSize: 12, fill: "#13202e", formatter: (v: unknown) => fmt(Number(v)) }}>
              {data.map((d) => <Cell key={d.model} fill={MODEL_COLOR[d.model]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Models() {
  return (
    <>
      <PageTitle sub="Validation (731 origins, 2024–2025) chose each model's form; the final test (302 origins, Jan 1 – Oct 29, 2026) was scored once with everything frozen. Numbers are from the group report.">Models and results</PageTitle>

      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat label="Ridge vs previous-day naive" value="−18.3%" hint="system RMSE, final test" accent />
        <Stat label="Ridge vs selected SARIMA" value="−10.2%" hint="system RMSE, final test" />
        <Stat label="Zones where Ridge beats naive" value="8 of 8" hint="West is a near-tie (0.9%)" />
        <Stat label="Ridge bias at the daily peak" value="−1,770 MW" hint="underforecasts peaks" />
      </div>

      <Section title="ARMA(1,1) wins on AIC, not on residuals" aside="system, lag-24-differenced log load, training">
        <div className="grid gap-10 md:grid-cols-[1fr_280px]">
          <table className="w-full text-[14px]">
            <thead className="text-left text-muted"><tr><th className="py-2 font-medium">Candidate</th><th className="font-medium">Training AIC</th><th className="font-medium">AR root</th><th className="font-medium">MA root</th><th className="font-medium">Residual ACF 24 / 168</th></tr></thead>
            <tbody>{ARMA.map((a) => (
              <tr key={a.cand} className="border-t border-rule" style={a.cand === "ARMA(1,1)" ? { background: "var(--heat-soft)" } : undefined}>
                <td className="py-2 font-semibold">{a.cand}</td><td className="num">{fmt(a.aic, 1)}</td><td className="num">{a.ar}</td><td className="num">{a.ma}</td><td className="num">{a.resid}</td></tr>
            ))}</tbody>
          </table>
          <div className="text-[13px] leading-relaxed text-muted">
            <p><b className="text-ink">Lowest AIC is not white noise.</b> Ljung–Box p-values are effectively 0 at lags 48 and 168 for all three; ARMA(1,1) residual ACF at lag 168 stays near 0.29.</p>
            <p className="mt-3"><b className="text-ink">Holt–Winters (AAA):</b> level {HOLT_WINTERS.level}, trend {HOLT_WINTERS.trend}, seasonal {HOLT_WINTERS.seasonal.toFixed(1)}.</p>
          </div>
        </div>
      </Section>

      <Section title="Validation picked a SARIMA form per series" aside="RMSE on 731 validation origins, MW">
        <div className="flex flex-wrap gap-3">
          {SARIMA_FORMS.map((s) => (
            <div key={s.series} className="rounded-lg border border-rule bg-panel px-4 py-3" style={{ borderTop: `4px solid ${s.form === "MA(1)" ? "var(--heat)" : "var(--sky)"}` }}>
              <div className="text-[14px] font-semibold">{s.series}</div>
              <div className="text-[13px] text-muted">{s.form} · {fmt(s.val, 1)} MW</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-muted">7 of 9 series use ARMA(1,1); Far West and North use MA(1). A weekly seasonal AR candidate did not beat the daily ARMA(1,1) on system validation.</p>
      </Section>

      <Section title="Validation chose Ridge; the test confirmed it" aside="system RMSE, MW">
        <div className="grid gap-10 md:grid-cols-2">
          <RmseChart data={rmseBars(VALIDATION_RMSE)} title="Validation · 731 origins" />
          <RmseChart data={rmseBars(Object.fromEntries(MODELS.map((m) => [m, TEST[m].rmse])))} title="Final test · 302 origins" />
        </div>
        <table className="mt-6 w-full text-[14px]">
          <thead className="text-left text-muted"><tr><th className="py-2 font-medium">Final test</th><th className="font-medium">RMSE (MW)</th><th className="font-medium">MAE (MW)</th><th className="font-medium">Bias (MW)</th><th className="font-medium">MASE</th></tr></thead>
          <tbody>{MODELS.map((m) => (
            <tr key={m} className="border-t border-rule"><td className="py-2 font-semibold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: MODEL_COLOR[m] }} />{m}</td>
              <td className="num">{fmt(TEST[m].rmse, 1)}</td><td className="num">{fmt(TEST[m].mae, 1)}</td>
              <td className="num">{TEST[m].bias > 0 ? "+" : ""}{fmt(TEST[m].bias, 1)}</td><td className="num">{TEST[m].mase.toFixed(3)}</td></tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-[13px] text-muted">Bias = forecast − actual (negative = underforecast). 302 origins × 24 leads = 7,248 system rows per model. One 2026 test period: it does not establish that Ridge will dominate in future years.</p>
      </Section>

      <Section title="Ridge gains hold across zones" aside="final-test RMSE reduction vs previous-day naive">
        <div className="grid gap-10 md:grid-cols-2">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={ZONES_TEST.filter((z) => z.series !== "System")} layout="vertical" margin={{ left: 8, right: 40 }}>
                <XAxis type="number" hide domain={[0, 24]} />
                <YAxis type="category" dataKey="series" width={110} tickLine={false} axisLine={false} fontSize={13} />
                <Tooltip formatter={(v) => `${v}% lower RMSE`} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Bar dataKey="gain" radius={[0, 3, 3, 0]} animationDuration={800} label={{ position: "right", fontSize: 12, fill: "#13202e", formatter: (v: unknown) => `${v}%` }}>
                  {ZONES_TEST.filter((z) => z.series !== "System").map((z) => <Cell key={z.series} fill={z.gain < 2 ? "#b4bcc5" : "var(--heat)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-[14px]">
            <thead className="text-left text-muted"><tr><th className="py-2 font-medium">RMSE (MW)</th><th className="font-medium">Ridge</th><th className="font-medium">SARIMA</th><th className="font-medium">Naive 24</th></tr></thead>
            <tbody>{ZONES_TEST.map((z) => (
              <tr key={z.series} className={`border-t border-rule ${z.series === "System" ? "font-semibold" : ""}`}>
                <td className="py-1.5">{z.series}</td><td className="num font-semibold" style={{ color: "#b8461a" }}>{fmt(z.ridge, 1)}</td><td className="num">{fmt(z.sarima, 1)}</td><td className="num">{fmt(z.naive, 1)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[13px] text-muted">Compare percentages, not MW, across zones of very different size. West is a near-tie: all three methods fall within 2.6 MW.</p>
      </Section>

      <Section title="No single method wins at every lead" aside="system RMSE, final test, MW">
        <div className="grid gap-10 md:grid-cols-2">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={LEADS} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="lead" tickLine={false} axisLine={false} fontSize={12} tickFormatter={(l) => `lead ${l}`} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} tickFormatter={kFmt} />
                <Tooltip formatter={(v, n) => [`${fmt(Number(v), 1)} MW`, n]} labelFormatter={(l) => `Lead ${l} h`} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                {(["Ridge", "SARIMA", "Naive 24"] as const).map((m) => <Bar key={m} dataKey={m} fill={MODEL_COLOR[m]} radius={[2, 2, 0, 0]} animationDuration={800} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <table className="w-full text-[14px]">
              <thead className="text-left text-muted"><tr><th className="py-2 font-medium">By season</th><th className="font-medium">Ridge</th><th className="font-medium">SARIMA</th><th className="font-medium">Naive 24</th></tr></thead>
              <tbody>{SEASONS.map((s) => (
                <tr key={s.season} className="border-t border-rule"><td className="py-2">{s.season}</td>
                  <td className="num font-semibold" style={{ color: "#b8461a" }}>{fmt(s.Ridge)}</td><td className="num">{fmt(s.SARIMA)}</td><td className="num">{fmt(s["Naive 24"])}</td></tr>
              ))}</tbody>
            </table>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">SARIMA is marginally best at lead 1; Ridge leads at 6, 12 and 24; naive 24 edges it at lead 18, where every method has its largest error. Error is not monotone in lead. Ridge is lowest in every season.</p>
          </div>
        </div>
      </Section>

      <Section title="The caveat: Ridge underforecasts peaks" aside="system bias, forecast − actual, MW">
        <div className="grid gap-10 md:grid-cols-2">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={PEAK_BIAS} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis dataKey="what" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} tickFormatter={kFmt} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Tooltip formatter={(v, n) => [`${fmt(Number(v), 1)} MW`, n]} cursor={{ fill: "rgba(19,32,46,0.04)" }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                {(["Ridge", "SARIMA", "Naive 24"] as const).map((m) => <Bar key={m} dataKey={m} fill={MODEL_COLOR[m]} radius={[0, 0, 2, 2]} animationDuration={800} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-4 text-[14px] leading-relaxed">
            <Stat label="Ridge mean bias at the daily peak hour" value="−1,770 MW" hint="302 origins" accent />
            <p className="text-muted">On average high-load hours Ridge is still best (RMSE 3,284 vs SARIMA 3,374 and naive 3,507 MW), but at the single peak hour its MAE is worse (3,459 vs 3,009 and 2,984 MW): it follows the daily shape and flattens below the evening peak.</p>
          </div>
        </div>
      </Section>

      <Section title="Takeaways">
        <div className="grid gap-4 md:grid-cols-3">
          {[["−18.3%", "Ridge system RMSE vs naive 24; ahead of naive in all eight zones, West nearly tied."],
            ["−1,770 MW", "Ridge bias at the daily peak hour; peak-hour MAE worse than naive and SARIMA."],
            ["Not white noise", "Residuals of the statistical models stay dependent: forecast accuracy is not residual adequacy."]].map(([a, b]) => (
            <div key={a} className="rounded-lg border border-rule bg-panel p-5"><div className="text-[24px] font-extrabold">{a}</div><div className="mt-1 text-[14px] text-muted">{b}</div></div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-muted">Limitations: one 2026 test period (origins end Oct 29); time zone not certified by the source; no weather forecast, LSTM or joint model; cross-correlation is not causal.</p>
      </Section>
    </>
  );
}
