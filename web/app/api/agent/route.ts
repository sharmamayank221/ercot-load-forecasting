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
        actual_peak_mw: r.actual_peak_mw, day_mape_pct: r.mape_pct, weather: r.weather };
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
    ["model_card", "Which model is used and every model's test MAPE.", S({}, [])],
  ].map(([n, d, p]) => ({ type: "function", function: { name: n, description: d, parameters: p } }));
  return { impl, schema, charts };
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
      if (!msg.tool_calls?.length) return reply(msg.content ?? "");
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
