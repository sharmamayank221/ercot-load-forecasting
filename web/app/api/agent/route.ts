/**
 * Grid-analyst agent as a Next.js server route.
 * A model answers by calling tools that read the same precomputed JSON the pages use.
 * Every number in an answer comes from a tool result.
 *
 * Backends (both speak the OpenAI chat-completions format):
 *   ollama  local, free. Used when running on your Mac (`npm run dev`) with `ollama serve` running.
 *           OLLAMA_MODEL (default qwen2.5:7b-instruct), OLLAMA_BASE_URL (default http://localhost:11434)
 *   groq    hosted. Used on Vercel.  GROQ_API_KEY (required), GROQ_MODEL (optional)
 * Choose with LLM_PROVIDER=ollama|groq; if unset: groq when GROQ_API_KEY exists, else ollama.
 */
import { ZONE_KEYS } from "@/lib/api";

export const maxDuration = 30;

function llmConfig() {
  const provider = process.env.LLM_PROVIDER ?? (process.env.GROQ_API_KEY ? "groq" : "ollama");
  if (provider === "ollama") {
    const base = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    return { provider, url: `${base}/v1/chat/completions`, key: "", model: process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct" };
  }
  return { provider, url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY ?? "",
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile" };
}
const SYSTEM = `You are a grid-operations analyst for ERCOT, the Texas power grid.
Answer questions about electricity demand using ONLY the tools provided.
Rules:
- Every number you state must come from a tool result in this conversation. Never estimate.
- For actual historical load use get_load. For hotter/colder scenarios use what_if.
  For whether a day was a high-peak day use peak_risk. For the model's prediction use forecast_load.
  For rankings of days use top_days; for comparing zones use compare_zones; for model accuracy by
  zone/season/hour use forecast_errors; for whether the peak alert would have fired use system_alert.
- Report numbers exactly as the tools give them (you may add thousands separators). Do not do arithmetic
  on them; if a difference or percentage is needed, use the field the tool provides.
- MAPE is a percentage error (lower is better). Never call it accuracy.
- Zones: Coast, East, Far West, North, North Central, South Central, Southern, West.
- Load data covers 2018 to early Nov 2026; forecasts and what-if cover Jan 2025 to early Nov 2026.
  If a date is outside the range, say so instead of guessing.
- Keep answers short: the key numbers in **bold**, one sentence of interpretation. Do not list the tools; the app shows them.
- For follow-up questions, reuse the zone or date from earlier in the conversation when the user does not repeat it.
- When asked to compare, use a small Markdown table.`;

type Json = Record<string, unknown>;
/** Chart data attached to an answer for the UI. Never sent to the model (saves tokens). */
export type Chart = { title: string; hours: number[]; series: { name: string; values: number[]; kind: "actual" | "forecast" | "alt" | "naive" }[] };

function makeTools(origin: string) {
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
    ["model_card", "Which model is used and every model's test MAPE.", S({}, [])],
  ].map(([n, d, p]) => ({ type: "function", function: { name: n, description: d, parameters: p } }));
  return { impl, schema, charts };
}

/**
 * Grounding check: every number in the answer must match a number in a tool result, tool argument or the
 * question, allowing for rounding, sign and MW<->GW scaling. Dates and integers 0-10 are skipped (counts,
 * hours, small labels). Returns the numbers that could not be traced, so the UI can flag them.
 */
function grounding(answer: string, sources: unknown[]) {
  const pool: number[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "number") pool.push(v);
    else if (typeof v === "string") (v.match(/-?\d+(?:\.\d+)?/g) ?? []).forEach((x) => pool.push(Number(x)));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  sources.forEach(collect);
  const text = answer.replace(/\d{4}-\d{2}-\d{2}/g, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const found = [...text.matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]);
  const checked: string[] = [], ungrounded: string[] = [];
  for (const raw of found) {
    const x = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(x) || (Number.isInteger(x) && Math.abs(x) <= 10)) continue;
    checked.push(raw);
    const dec = (raw.split(".")[1] ?? "").length, tol = 0.5 * 10 ** -dec + 1e-9;
    const ok = pool.some((p) => [p, Math.abs(p), p / 1000, Math.abs(p) / 1000, p * 1000]
      .some((c) => Math.abs(Math.abs(x) - Math.abs(c)) <= tol * (c === p * 1000 ? 1000 : 1)));
    if (!ok) ungrounded.push(raw);
  }
  return { checked: checked.length, ungrounded };
}

export async function POST(req: Request) {
  const { question, history } = (await req.json().catch(() => ({}))) as { question?: string; history?: { role: string; text: string }[] };
  if (!question?.trim()) return Response.json({ answer: "Ask a question.", tools: [] });
  const llm = llmConfig();
  if (llm.provider === "groq" && !llm.key) {
    return Response.json({ answer: "Agent unavailable: set GROQ_API_KEY in the Vercel project's environment variables (free key at console.groq.com).", tools: [] });
  }
  const { impl, schema, charts } = makeTools(new URL(req.url).origin);
  // last few turns, so follow-ups like "what about Coast?" work; only text, never old tool output
  const past = (history ?? []).slice(-6).filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, 1500) }));
  const messages: Json[] = [{ role: "system", content: SYSTEM }, ...past, { role: "user", content: question }];
  const used: string[] = [];
  const trace: { tool: string; args: Json; result: Json }[] = [];
  const reply = (answer: string) => Response.json({ answer, tools: used, trace, charts, model: `${llm.provider}: ${llm.model}` });
  try {
    for (let round = 0; round < 6; round++) {
      let r: Response;
      try {
        r = await fetch(llm.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(llm.key ? { Authorization: `Bearer ${llm.key}` } : {}) },
          body: JSON.stringify({ model: llm.model, messages, tools: schema, tool_choice: "auto", temperature: 0 }),
        });
      } catch {
        const hint = llm.provider === "ollama"
          ? `cannot reach Ollama at ${llm.url.replace("/v1/chat/completions", "")}. Is \`ollama serve\` running? (On Vercel, set GROQ_API_KEY instead.)`
          : "cannot reach Groq.";
        return reply(`Agent unavailable: ${hint}`);
      }
      if (!r.ok) {
        const body = await r.text();
        const hint = llm.provider === "ollama" && r.status === 404 ? ` Run \`ollama list\` and set OLLAMA_MODEL to a model you have.` : "";
        return reply(`Agent unavailable: ${llm.provider} returned ${r.status} ${body.slice(0, 200)}.${hint}`);
      }
      const msg = (await r.json()).choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls?.length) {
        const answer = msg.content ?? "";
        const g = grounding(answer, [question, ...trace.map((t) => t.result), ...trace.map((t) => t.args)]);
        return Response.json({ answer, tools: used, trace, charts, model: `${llm.provider}: ${llm.model}`, grounding: g });
      }
      for (const call of msg.tool_calls) {
        const fn = impl[call.function.name];
        let result: Json, args: Json = {};
        try { args = JSON.parse(call.function.arguments || "{}"); result = fn ? await fn(args) : { error: "unknown tool" }; }
        catch (e) { result = { error: (e as Error).message }; }
        used.push(call.function.name);
        trace.push({ tool: call.function.name, args, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return reply("Stopped after too many tool calls; try a more specific question.");
  } catch (e) {
    return reply(`Agent unavailable: ${(e as Error).message}`);
  }
}
