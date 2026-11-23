/**
 * The agent's tools, shared by the chat route (/api/agent) and the briefing email route (/api/brief-email).
 * Each tool reads the precomputed JSON under /public/data; charts are collected for the UI, never sent to the model.
 */
import { ZONE_KEYS } from "@/lib/api";

export type Json = Record<string, unknown>;
/** Chart data attached to an answer for the UI. Never sent to the model (saves tokens). */
export type Chart = { title: string; hours: number[]; series: { name: string; values: number[]; kind: "actual" | "forecast" | "alt" | "naive" }[] };

export function makeTools(origin: string) {
  const cache = new Map<string, Promise<unknown>>();
  const data = <T,>(f: string): Promise<T> => {
    if (!cache.has(f)) cache.set(f, fetch(`${origin}/data/${f}`).then((r) => {
      if (!r.ok) throw new Error(`missing ${f}`);
      return r.json();
    }));
    return cache.get(f) as Promise<T>;
  };
  const zkey = (z: string) => {
    const k = ZONE_KEYS[z] ?? Object.entries(ZONE_KEYS).find(([n, v]) => n.toLowerCase() === String(z).toLowerCase() || v.toLowerCase() === String(z).toLowerCase())?.[1];
    if (!k) throw new Error(`unknown zone ${z}; use one of ${Object.keys(ZONE_KEYS).join(", ")}`);
    return k;
  };
  const name = (k: string) => Object.entries(ZONE_KEYS).find(([, v]) => v === k)![0];
  const hourOf = (d: string) => Math.floor(Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 3_600_000);
  type DayRec = { hour: number[]; forecast: number[]; actual: number[]; naive: number[]; peak_mw: number; peak_hour: number; mean_mw: number; actual_peak_mw: number; mape_pct: number; weather: Json };
  const charts: Chart[] = [];

  const impl: Record<string, (a: Json) => Promise<Json>> = {
    async get_load({ zone, start, end }) {
      const k = zkey(String(zone));
      const f = await data<{ t: number[]; mw: number[] }>(`load/${k}.json`);
      const lo = hourOf(String(start)), hi = hourOf(String(end ?? start)) + 24;
      let n = 0, sum = 0, max = -Infinity, min = Infinity, at = 0;
      const daily: Record<string, number> = {};
      for (let i = 0; i < f.t.length; i++) {
        if (f.t[i] < lo || f.t[i] >= hi) continue;
        const v = f.mw[i]; n++; sum += v;
        if (v > max) { max = v; at = f.t[i]; }
        if (v < min) min = v;
        const day = new Date(f.t[i] * 3_600_000).toISOString().slice(0, 10);
        daily[day] = Math.max(daily[day] ?? 0, v);
      }
      if (!n) return { error: `no load data for ${name(k)} in that range (data covers 2018-01-01 to 2026-11-04)` };
      if (hi - lo === 24) {
        const hrs: number[] = [], vals: number[] = [];
        for (let i = 0; i < f.t.length; i++) if (f.t[i] >= lo && f.t[i] < hi) { hrs.push(f.t[i] - lo); vals.push(f.mw[i]); }
        charts.push({ title: `${name(k)}, ${String(start).slice(0, 10)}: actual load`, hours: hrs, series: [{ name: "actual", values: vals, kind: "actual" }] });
      }
      const days = Object.keys(daily);
      return { zone: name(k), hours: n, mean_mw: Math.round(sum / n), min_mw: min, max_mw: max,
        peak_time: new Date(at * 3_600_000).toISOString().slice(0, 16).replace("T", " "),
        daily_peaks_mw: days.length <= 14 ? daily : `${days.length} days; ask for a shorter range for daily detail` };
    },
    async get_weather({ zone, date }) {
      const k = zkey(String(zone));
      const f = await data<{ t: number[]; temp: (number | null)[] }>(`load/${k}.json`);
      const lo = hourOf(String(date)), temps: number[] = [];
      for (let i = 0; i < f.t.length; i++) if (f.t[i] >= lo && f.t[i] < lo + 24 && f.temp[i] != null) temps.push(f.temp[i] as number);
      if (!temps.length) return { error: `no weather for ${name(k)} on ${date}` };
      return { zone: name(k), date, temp_high_f: Math.max(...temps), temp_low_f: Math.min(...temps) };
    },
    async forecast_load({ zone, date }) {
      const k = zkey(String(zone));
      const fc = await data<Record<string, DayRec>>(`forecast/${k}.json`);
      const r = fc[String(date)];
      if (!r) return { error: `no forecast for ${date}; forecasts cover 2025-01-01 to 2026-11-04` };
      charts.push({ title: `${name(k)}, ${date}: forecast vs actual`, hours: r.hour, series: [
        { name: "actual", values: r.actual, kind: "actual" }, { name: "forecast", values: r.forecast, kind: "forecast" },
        { name: "same hour last week", values: r.naive, kind: "naive" }] });
      return { zone: name(k), date, forecast_peak_mw: r.peak_mw, forecast_peak_hour: r.peak_hour, forecast_mean_mw: r.mean_mw,
        actual_peak_mw: r.actual_peak_mw, peak_error_mw: r.peak_mw - r.actual_peak_mw,
        peak_error_pct: Math.round(((r.peak_mw / r.actual_peak_mw) - 1) * 1000) / 10, day_mape_pct: r.mape_pct, weather: r.weather };
    },
    async what_if({ zone, date, temp_shift_f }) {
      const k = zkey(String(zone));
      const [meta, wi] = await Promise.all([data<{ shifts: number[] }>("meta.json"), data<Record<string, number[][]>>(`whatif/${k}.json`)]);
      const rows = wi[String(date)];
      if (!rows) return { error: `no scenario for ${date}; available 2025-01-01 to 2026-11-04` };
      const want = Number(temp_shift_f ?? 0);
      const i = meta.shifts.reduce((b, s, j) => (Math.abs(s - want) < Math.abs(meta.shifts[b] - want) ? j : b), 0);
      const base = Math.max(...rows[meta.shifts.indexOf(0)]), alt = Math.max(...rows[i]);
      charts.push({ title: `${name(k)}, ${date}: ${meta.shifts[i] > 0 ? "+" : ""}${meta.shifts[i]}°F scenario`, hours: rows[0].map((_, h) => h), series: [
        { name: "forecast as observed", values: rows[meta.shifts.indexOf(0)], kind: "forecast" },
        { name: `${meta.shifts[i] > 0 ? "+" : ""}${meta.shifts[i]}°F`, values: rows[i], kind: "alt" }] });
      return { zone: name(k), date, temp_shift_f: meta.shifts[i], note: meta.shifts[i] !== want ? "shift rounded to the nearest 3°F step" : undefined,
        peak_mw_base: base, peak_mw_shifted: alt, peak_change_mw: alt - base, peak_change_pct: Math.round(((alt / base) - 1) * 1000) / 10 };
    },
    async peak_risk({ date }) {
      const p = await data<{ days: { day: string; peak_mw: number; cutoff_mw: number; high: boolean }[] }>("peaks.json");
      const d = p.days.find((x) => x.day === String(date));
      if (!d) return { error: `no peak-day record for ${date}` };
      return { date: d.day, system_peak_mw: Math.round(d.peak_mw), cutoff_mw: Math.round(d.cutoff_mw), high_peak_day: d.high,
        margin_pct: Math.round((d.peak_mw / d.cutoff_mw - 1) * 1000) / 10 };
    },
    async top_days({ scope, start, end, n, order, months }) {
      const d = await data<{ days: string[]; system_peak: number[]; tmax_dfw: (number | null)[]; zones: Record<string, { peak: (number | null)[] }> }>("daily.json");
      const sys = !scope || String(scope).toLowerCase() === "system" || String(scope).toLowerCase() === "ercot";
      const k = sys ? "" : zkey(String(scope));
      const vals = sys ? d.system_peak : d.zones[k].peak;
      const lo = String(start ?? d.days[0]), hi = String(end ?? d.days[d.days.length - 1]);
      const mset = Array.isArray(months) ? new Set((months as unknown[]).map(Number)) : null;
      const rows = d.days.map((day, i) => ({ day, peak_mw: vals[i], dfw_temp_high_f: d.tmax_dfw[i] }))
        .filter((r) => r.peak_mw != null && r.day >= lo && r.day <= hi && (!mset || mset.has(Number(r.day.slice(5, 7)))));
      if (!rows.length) return { error: "no days match; data covers 2018-01-01 to 2026-11-04" };
      rows.sort((a, b) => (order === "lowest" ? (a.peak_mw! - b.peak_mw!) : (b.peak_mw! - a.peak_mw!)));
      const k2 = Math.min(Math.max(Number(n ?? 5), 1), 20);
      return { scope: sys ? "ERCOT system" : name(k), period: `${lo} to ${hi}`, order: order === "lowest" ? "lowest" : "highest",
        days_considered: rows.length, days: rows.slice(0, k2) };
    },
    async compare_zones({ start, end }) {
      const d = await data<{ days: string[]; zones: Record<string, { peak: (number | null)[]; mean: (number | null)[] }> }>("daily.json");
      const lo = String(start), hi = String(end ?? start);
      const idx = d.days.map((day, i) => [day, i] as const).filter(([day]) => day >= lo && day <= hi);
      if (!idx.length) return { error: "no days in that range; data covers 2018-01-01 to 2026-11-04" };
      const out = Object.entries(d.zones).map(([k, z]) => {
        let best = -Infinity, bestDay = "", sum = 0, cnt = 0;
        for (const [day, i] of idx) {
          const p = z.peak[i], m = z.mean[i];
          if (p != null && p > best) { best = p; bestDay = day; }
          if (m != null) { sum += m; cnt++; }
        }
        return { zone: name(k), peak_mw: best, peak_day: bestDay, average_mw: Math.round(sum / Math.max(cnt, 1)) };
      }).sort((a, b) => b.peak_mw - a.peak_mw);
      return { period: `${lo} to ${hi}`, days: idx.length, zones: out };
    },
    async forecast_errors({ zone, start, end, by }) {
      const keys = zone ? [zkey(String(zone))] : Object.values(ZONE_KEYS);
      const lo = String(start ?? "2025-01-01"), hi = String(end ?? "2026-12-31");
      const groupBy = ["zone", "month", "season", "hour"].includes(String(by)) ? String(by) : (zone ? "season" : "zone");
      const season = (m: number) => (m === 12 || m <= 2 ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "fall");
      const acc: Record<string, { ape: number; err: number; n: number }> = {};
      for (const k of keys) {
        const fc = await data<Record<string, { hour: number[]; forecast: number[]; actual: number[] }>>(`forecast/${k}.json`);
        for (const [day, r] of Object.entries(fc)) {
          if (day < lo || day > hi) continue;
          const m = Number(day.slice(5, 7));
          r.hour.forEach((h, i) => {
            const g = groupBy === "zone" ? name(k) : groupBy === "month" ? day.slice(0, 7) : groupBy === "season" ? season(m) : String(h).padStart(2, "0") + ":00";
            const a = r.actual[i], f = r.forecast[i];
            if (!a) return;
            (acc[g] ??= { ape: 0, err: 0, n: 0 });
            acc[g].ape += Math.abs(f - a) / a; acc[g].err += f - a; acc[g].n++;
          });
        }
      }
      const groups = Object.entries(acc).map(([g, v]) => ({ [groupBy]: g, mape_pct: Math.round((v.ape / v.n) * 1000) / 10,
        mean_bias_mw: Math.round(v.err / v.n), hours: v.n }));
      if (!groups.length) return { error: "no forecasts in that range; forecasts cover 2025-01-01 to 2026-11-04" };
      if (groupBy === "zone" || groupBy === "season") groups.sort((a, b) => (b.mape_pct as number) - (a.mape_pct as number));
      return { zones: zone ? name(keys[0]) : "all", period: `${lo} to ${hi}`, grouped_by: groupBy,
        note: "mean_bias_mw > 0 means the model over-forecasts on average", groups };
    },
    async system_alert({ date }) {
      const day = String(date);
      const files = await Promise.all(Object.values(ZONE_KEYS).map((k) => data<Record<string, { hour: number[]; forecast: number[]; actual: number[] }>>(`forecast/${k}.json`)));
      if (!files.every((f) => f[day])) return { error: `no forecast for ${day}; forecasts cover 2025-01-01 to 2026-11-04` };
      const hours = files[0][day].hour;
      const fc = hours.map((_, i) => files.reduce((s, f) => s + (f[day].forecast[i] ?? 0), 0));
      const act = hours.map((_, i) => files.reduce((s, f) => s + (f[day].actual[i] ?? 0), 0));
      const p = await data<{ days: { day: string; peak_mw: number; cutoff_mw: number; high: boolean }[] }>("peaks.json");
      const rec = p.days.find((x) => x.day === day);
      if (!rec) return { error: `no high-peak cutoff recorded for ${day}` };
      const peak = Math.max(...fc), margin = (peak / rec.cutoff_mw - 1) * 100;
      const level = margin >= 0 ? "ALERT" : margin >= -3 ? "WATCH" : "NORMAL";
      charts.push({ title: `ERCOT system, ${day}: forecast vs actual (cutoff ${Math.round(rec.cutoff_mw).toLocaleString("en-US")} MW)`, hours, series: [
        { name: "actual", values: act, kind: "actual" }, { name: "forecast (sum of zones)", values: fc, kind: "forecast" },
        { name: "high-peak cutoff", values: hours.map(() => Math.round(rec.cutoff_mw)), kind: "naive" }] });
      return { date: day, alert_level: level, rule: "ALERT if forecast peak >= cutoff, WATCH if within 3%",
        forecast_system_peak_mw: Math.round(peak), cutoff_mw: Math.round(rec.cutoff_mw), margin_pct: Math.round(margin * 10) / 10,
        actual_system_peak_mw: Math.round(Math.max(...act)), actual_high_peak_day: rec.high };
    },
    async region_briefing({ zone, date }) {
      const k = zkey(String(zone));
      const day = String(date);
      const fc = await data<Record<string, DayRec>>(`forecast/${k}.json`);
      const r = fc[day];
      if (!r) return { error: `no forecast for ${day}; briefings cover 2025-01-01 to 2026-11-04` };
      // 1. the region's own forecast and its usual level for this month (same month, previous two years)
      const d = await data<{ days: string[]; zones: Record<string, { peak: (number | null)[] }> }>("daily.json");
      const y = Number(day.slice(0, 4)), m = day.slice(5, 7);
      const same = d.days.map((dd, i) => [dd, d.zones[k].peak[i]] as const)
        .filter(([dd, v]) => v != null && dd.slice(5, 7) === m && Number(dd.slice(0, 4)) >= y - 2 && Number(dd.slice(0, 4)) < y)
        .map(([, v]) => v as number).sort((a, b) => a - b);
      const typical = same.length ? same[Math.floor(same.length / 2)] : null;
      const vsTypical = typical ? Math.round(((r.peak_mw / typical) - 1) * 1000) / 10 : null;
      // 2. hours within 5% of the forecast peak = the window to avoid
      // flat days (winter) put most hours near the peak: then use the few hours around the peak instead
      const fmtH = (h: number) => (h % 24 === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`);
      const near = r.hour.filter((_, i) => r.forecast[i] >= 0.97 * r.peak_mw);
      let w0 = Math.min(...near), w1 = Math.max(...near) + 1;
      if (!near.length || w1 - w0 > 6) { w0 = Math.max(r.peak_hour - 1, 0); w1 = Math.min(r.peak_hour + 2, 24); }
      const window = `${fmtH(w0)} to ${fmtH(w1)}`;
      // 3. whole-grid alert level (grid stress is system-wide even when the user cares about one region)
      const n = charts.length;
      const sa = await impl.system_alert({ date: day });
      charts.length = n;                                   // keep the region chart, not the system one
      const level = (sa.alert_level as string) ?? "UNKNOWN";
      const t = (r.weather as { temp_high_f: number; temp_low_f: number });
      // 4. what matters, and what to do: fixed rules, so the advice is consistent and checkable
      const important: string[] = [];
      const advice: string[] = [];
      if (level === "ALERT") {
        important.push(`The ERCOT grid is forecast to cross its high-peak threshold (${sa.margin_pct}% above the cutoff).`);
        advice.push(`Shift laundry, dishwashing and EV charging out of ${window}.`);
        if (t.temp_high_f >= 85) advice.push(`Pre-cool the home before ${fmtH(w0)}, then raise the thermostat 2 to 3 °F until ${fmtH(w1)}.`);
        else if (t.temp_low_f <= 40) advice.push(`Pre-heat the home before ${fmtH(w0)}, then lower the thermostat 2 to 3 °F until ${fmtH(w1)}.`);
        advice.push("Watch for ERCOT conservation appeals.");
      } else if (level === "WATCH") {
        const gap = Math.abs(Number(sa.margin_pct));
        important.push(gap < 0.5 ? "Grid demand is forecast just below the high-peak threshold."
          : `Grid demand is forecast within ${gap}% of the high-peak threshold.`);
        advice.push(`If you can, move flexible electricity use out of ${window}.`);
      } else {
        advice.push("No grid stress expected: normal electricity use is fine.");
      }
      if (vsTypical != null && vsTypical >= 10) important.push(`${name(k)}'s forecast peak is ${vsTypical}% above a typical day this month.`);
      if (t.temp_high_f >= 100) { important.push(`Extreme heat: a high of ${t.temp_high_f} °F.`); advice.push("Limit outdoor activity in the afternoon and check on vulnerable neighbours."); }
      if (t.temp_low_f <= 32) { important.push(`Freezing temperatures: a low of ${t.temp_low_f} °F.`); advice.push(`Protect exposed pipes. Demand in ${name(k)} peaks around ${fmtH(r.peak_hour)}, so run heavy appliances outside ${window}.`); }
      if (!important.length) important.push("Nothing unusual is expected in this region.");
      charts.push({ title: `${name(k)}, ${day}: forecast load`, hours: r.hour, series: [{ name: "forecast", values: r.forecast, kind: "forecast" }] });
      return { region: name(k), date: day, grid_alert_level: level, forecast_peak_mw: r.peak_mw, peak_hour: r.peak_hour,
        peak_window: window, typical_peak_this_month_mw: typical, vs_typical_pct: vsTypical,
        temp_high_f: t.temp_high_f, temp_low_f: t.temp_low_f, important, recommendations: advice,
        actual_peak_mw: r.actual_peak_mw, note: "recommendations are generated by fixed rules from these numbers" };
    },
    async model_card() {
      const m = await data<Json>("meta.json");
      return { model: m.model, forecast_period: `${m.forecast_start} to ${m.forecast_end}`, test_year_leaderboard_mape_pct: m.leaderboard };
    },
  };

  const S = (props: Json, required: string[]) => ({ type: "object", properties: props, required });
  const zone = { type: "string", description: "ERCOT weather zone, e.g. North Central" };
  const date = { type: "string", description: "YYYY-MM-DD" };
  const schema = [
    ["get_load", "Actual hourly load (MW) for a zone between two dates: mean, min, max, peak time, daily peaks.", S({ zone, start: date, end: date }, ["zone", "start"])],
    ["get_weather", "Observed temperature high and low (°F) for a zone on a date.", S({ zone, date }, ["zone", "date"])],
    ["forecast_load", "The model's day-ahead forecast for a zone and date: forecast peak, actual peak, and the day's error.", S({ zone, date }, ["zone", "date"])],
    ["what_if", "Forecast peak for a zone and date if every hour were warmer or cooler by temp_shift_f °F.", S({ zone, date, temp_shift_f: { type: "number" } }, ["zone", "date", "temp_shift_f"])],
    ["peak_risk", "Whether a date was a high-peak day for the whole ERCOT system, its peak and the cutoff.", S({ date }, ["date"])],
    ["top_days", "Highest (or lowest) daily peaks for the ERCOT system or one zone in a period, optionally only some months. Use for 'which days', 'record', 'hottest days' questions.", S({ scope: { type: "string", description: "'system' or a zone name" }, start: date, end: date, n: { type: "number", description: "how many days, max 20" }, order: { type: "string", enum: ["highest", "lowest"] }, months: { type: "array", items: { type: "number" }, description: "e.g. [6,7,8] for summer" } }, [])],
    ["compare_zones", "Peak and average load of all 8 zones over a date or range, sorted by peak.", S({ start: date, end: date }, ["start"])],
    ["forecast_errors", "Model forecast error (MAPE % and bias in MW) over a period, grouped by zone, month, season or hour. Use for 'where/when is the model worst' questions.", S({ zone, start: date, end: date, by: { type: "string", enum: ["zone", "month", "season", "hour"] } }, [])],
    ["system_alert", "Would the peak-demand alert have fired on a date: system forecast peak vs the high-peak cutoff, alert level, and what actually happened.", S({ date }, ["date"])],
    ["region_briefing", "Briefing for one region and date: what is important there (grid alert, unusual demand, extreme temperatures) and recommendations for residents. Use for 'brief me', 'what should I know', 'what should I do' questions.", S({ zone, date }, ["zone", "date"])],
    ["model_card", "Which model is used and every model's test MAPE.", S({}, [])],
  ].map(([n, d, p]) => ({ type: "function", function: { name: n, description: d, parameters: p } }));
  return { impl, schema, charts };
}
