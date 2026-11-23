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
import { regionByKey } from "@/lib/region";
import { makeTools } from "@/lib/agentTools";

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
  const { question, history, region } = (await req.json().catch(() => ({}))) as { question?: string; history?: { role: string; text: string }[]; region?: string };
  const home = regionByKey(region);
  if (!question?.trim()) return Response.json({ answer: "Ask a question.", tools: [] });
  const llm = llmConfig();
  if (llm.provider === "groq" && !llm.key) {
    return Response.json({ answer: "Agent unavailable: set GROQ_API_KEY in the Vercel project's environment variables (free key at console.groq.com).", tools: [] });
  }
  const { impl, schema, charts } = makeTools(new URL(req.url).origin);
  // last few turns, so follow-ups like "what about Coast?" work; only text, never old tool output
  const past = (history ?? []).slice(-6).filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, 1500) }));
  const scope = home ? `

The user's region is ${home.name} (${home.cities}).
- Answer for ${home.name} only, unless the user explicitly names another zone or asks about the whole grid.
- When a question doesn't name a zone, use ${home.name}.
- For "brief me", "what's important" or "what should I do" questions, call region_briefing for ${home.name}, then summarise:
  first what is important (one or two sentences), then the recommendations as a short bulleted list, worded exactly as the tool gives them.` : "";
  const messages: Json[] = [{ role: "system", content: SYSTEM + scope }, ...past, { role: "user", content: question }];
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
