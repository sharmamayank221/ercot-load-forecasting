"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Info, Mail, MessageSquare, Plus, Trash2, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { post, fmt, loadJSON, type Meta } from "@/lib/api";
import { REGIONS, loadRegion, saveRegion, type Region } from "@/lib/region";
import RegionPicker from "@/components/RegionPicker";

type Chart = { title: string; hours: number[]; series: { name: string; values: number[]; kind: "actual" | "forecast" | "alt" | "naive" }[] };
type Step = { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };
type Grounding = { checked: number; ungrounded: string[] };
type Reply = { answer: string; tools: string[]; trace?: Step[]; charts?: Chart[]; model?: string; grounding?: Grounding };
type Msg = { role: "user" | "assistant"; text: string; tools?: string[]; trace?: Step[]; charts?: Chart[]; model?: string; grounding?: Grounding };

function GroundingBadge({ g }: { g: Grounding }) {
  if (!g.checked) return null;
  const ok = g.ungrounded.length === 0;
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px]"
      style={{ background: ok ? "rgba(31,158,150,0.12)" : "var(--heat-soft)", color: ok ? "#14706a" : "#a8441c" }}
      title="Every number in the answer is checked against the tool results, allowing for rounding and MW/GW.">
      {ok ? `✓ all ${g.checked} number${g.checked > 1 ? "s" : ""} traced to tool results`
        : `⚠ ${g.ungrounded.length} of ${g.checked} number${g.checked > 1 ? "s" : ""} not found in tool results: ${g.ungrounded.join(", ")}`}
    </div>
  );
}

const starters = [
  "What were the 5 highest-demand days for the ERCOT system in 2026?",
  "Where is the model least accurate, by zone?",
  "Would the peak alert have fired on 2026-08-18?",
  "Compare all zones on 2026-07-22.",
  "What was the North Central peak on 2026-07-22?",
  "What happens to Coast load on 2026-08-15 if it is 6 degrees hotter?",
];

/** "Email this briefing": shown under answers that used region_briefing. The server rebuilds the briefing
 *  from the same zone and date, so the email carries the tool's numbers, not the model's wording. */
function EmailBriefing({ zone, date }: { zone: string; date: string }) {
  const [to, setTo] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "ok" | "err"; msg?: string }>({ kind: "idle" });
  useEffect(() => { try { setTo(localStorage.getItem("ercot-brief-email") ?? ""); } catch { /* ignore */ } }, []);
  async function sendMail(e: React.FormEvent) {
    e.preventDefault();
    if (!to.trim()) return;
    setState({ kind: "sending" });
    try {
      const r = await fetch("/api/brief-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zone, date, to: to.trim() }) });
      const j = await r.json();
      if (j.ok) { setState({ kind: "ok", msg: `Sent to ${j.to}.` }); try { localStorage.setItem("ercot-brief-email", to.trim()); } catch { /* ignore */ } }
      else setState({ kind: "err", msg: j.error ?? "Could not send." });
    } catch (err) { setState({ kind: "err", msg: (err as Error).message }); }
  }
  return (
    <form onSubmit={sendMail} className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-rule bg-paper px-3 py-2 text-[13px]">
      <Mail size={15} className="text-muted" />
      <span className="text-muted">Email this briefing to</span>
      <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@mavs.uta.edu" aria-label="Email address"
        className="min-w-[200px] flex-1 rounded border border-rule bg-panel px-2 py-1 text-[13px]" />
      <button type="submit" aria-label="Send briefing email" disabled={state.kind === "sending" || !to.trim()}
        className="rounded bg-ink px-3 py-1 font-semibold text-paper disabled:opacity-40">{state.kind === "sending" ? "Sending…" : "Send"}</button>
      {state.msg && <span className="w-full" style={{ color: state.kind === "ok" ? "#14706a" : "#a8441c" }}>{state.msg}</span>}
    </form>
  );
}

/** The zone and date of the last successful region_briefing call in an answer, if any. */
function briefingOf(trace?: Step[]) {
  const b = [...(trace ?? [])].reverse().find((t) => t.tool === "region_briefing" && !t.result.error);
  if (!b) return null;
  const zone = REGIONS.find((r) => r.name === b.result.region)?.key;
  return zone ? { zone, date: String(b.result.date) } : null;
}

const regionStarters = (z: string) => [
  `What was the highest-demand day in ${z} in 2026?`,
  `How accurate is the forecast for ${z}, by season?`,
  `What happens in ${z} on 2026-08-15 if it is 6 degrees hotter?`,
  "Would the grid alert have fired on 2026-08-18?",
];

const STYLE: Record<Chart["series"][number]["kind"], { color: string; width: number; dash?: string }> = {
  actual: { color: "var(--ink)", width: 2.6 },
  forecast: { color: "var(--sky)", width: 2 },
  alt: { color: "var(--heat)", width: 2.4 },
  naive: { color: "var(--muted)", width: 1.3, dash: "4 4" },
};

function MiniChart({ c }: { c: Chart }) {
  const data = c.hours.map((h, i) => Object.fromEntries([["hour", h], ...c.series.map((s) => [s.name, s.values[i]])]));
  return (
    <div className="mt-3 rounded-md border border-rule bg-paper px-3 pt-2">
      <div className="text-[12px] font-semibold text-muted">{c.title}</div>
      <div className="h-44">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: 0, right: 8, top: 6 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(h) => `${h}:00`} interval={5} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={38} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
            <Tooltip formatter={(v, n) => [`${fmt(Number(v))} MW`, n]} labelFormatter={(h) => `${h}:00`} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
            {c.series.map((s) => (
              <Line key={s.name} dataKey={s.name} stroke={STYLE[s.kind].color} strokeWidth={STYLE[s.kind].width}
                strokeDasharray={STYLE[s.kind].dash} dot={false} animationDuration={600} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Trace({ steps, model }: { steps: Step[]; model?: string }) {
  if (!steps.length) return null;
  return (
    <details className="mt-3 text-[13px]">
      <summary className="cursor-pointer select-none text-muted hover:text-ink">
        How I got this: {steps.length} tool call{steps.length > 1 ? "s" : ""}{model ? ` · ${model}` : ""}
      </summary>
      <ol className="mt-2 flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={i} className="rounded-md border border-rule bg-paper px-3 py-2">
            <div className="font-semibold">{i + 1}. {s.tool}<span className="font-normal text-muted">({Object.entries(s.args).map(([k, v]) => `${k}: ${v}`).join(", ")})</span></div>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[12px] text-muted">{JSON.stringify(s.result, null, 2)}</pre>
          </li>
        ))}
      </ol>
    </details>
  );
}

const md = {
  p: (p: React.ComponentProps<"p">) => <p className="my-1" {...p} />,
  strong: (p: React.ComponentProps<"strong">) => <strong className="num font-extrabold" {...p} />,
  ul: (p: React.ComponentProps<"ul">) => <ul className="my-1 list-disc pl-5" {...p} />,
  ol: (p: React.ComponentProps<"ol">) => <ol className="my-1 list-decimal pl-5" {...p} />,
  table: (p: React.ComponentProps<"table">) => <table className="my-2 w-full text-[14px]" {...p} />,
  th: (p: React.ComponentProps<"th">) => <th className="border-b border-ink py-1 pr-3 text-left font-semibold" {...p} />,
  td: (p: React.ComponentProps<"td">) => <td className="num border-b border-rule py-1 pr-3" {...p} />,
};

type Conversation = { id: string; title: string; updated: number; msgs: Msg[] };

const STORE = "ercot-analyst-chats-v1";
const MAX_CHATS = 30;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Saved chats live in this browser only (localStorage): no account, no server database. */
function loadChats(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.msgs)) : [];
  } catch { return []; }
}
function saveChats(list: Conversation[]) {
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX_CHATS))); }
  catch {   // storage full: drop the oldest chats and try once more
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 10))); } catch { /* give up quietly */ }
  }
}
function groupLabel(ts: number) {
  const day = 86_400_000, start = new Date(); start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return "Today";
  if (ts >= start.getTime() - day) return "Yesterday";
  if (ts >= start.getTime() - 6 * day) return "Previous 7 days";
  return "Older";
}

function History({ chats, active, onOpen, onDelete, onNew, onClear }: {
  chats: Conversation[]; active: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; onClear: () => void;
}) {
  const groups = chats.reduce<Record<string, Conversation[]>>((g, c) => { (g[groupLabel(c.updated)] ??= []).push(c); return g; }, {});
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-rule pr-5">
      <button onClick={onNew} className="flex items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-[14px] font-semibold text-paper">
        <Plus size={16} /> New chat
      </button>
      {chats.length === 0 && <p className="text-[13px] text-muted">Your chats will appear here. They are saved in this browser only.</p>}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {["Today", "Yesterday", "Previous 7 days", "Older"].filter((g) => groups[g]).map((g) => (
          <div key={g}>
            <div className="mb-1 text-[12px] font-semibold text-muted">{g}</div>
            <ul className="flex flex-col">
              <AnimatePresence initial={false}>
                {groups[g].map((c) => (
                  <motion.li key={c.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}
                    className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${c.id === active ? "bg-panel font-semibold shadow-[inset_2px_0_0_var(--heat)]" : "hover:bg-panel"}`}>
                    <MessageSquare size={14} className="shrink-0 text-muted" />
                    <button onClick={() => onOpen(c.id)} className="min-w-0 flex-1 truncate text-left" title={c.title}>{c.title}</button>
                    <button onClick={() => onDelete(c.id)} aria-label={`Delete chat: ${c.title}`}
                      className="shrink-0 text-muted opacity-0 transition-opacity hover:text-heat group-hover:opacity-100 focus:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        ))}
      </div>
      {chats.length > 1 && (
        <button onClick={onClear} className="text-left text-[12px] text-muted hover:text-heat">Delete all chats</button>
      )}
    </aside>
  );
}

export default function Analyst() {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const [region, setRegionState] = useState<Region | null>(null);
  const [briefDate, setBriefDate] = useState("2026-08-18");
  const [range, setRange] = useState<{ start: string; end: string }>({ start: "2025-01-01", end: "2026-11-04" });
  const setRegion = (r: Region | null) => { setRegionState(r); saveRegion(r); };

  useEffect(() => { setChats(loadChats()); setRegionState(loadRegion()); setLoaded(true); }, []);
  useEffect(() => { loadJSON<Meta>("meta.json").then((m) => setRange({ start: m.forecast_start, end: m.forecast_end })).catch(() => {}); }, []);
  useEffect(() => { if (loaded) saveChats(chats); }, [chats, loaded]);

  const current = chats.find((c) => c.id === active) ?? null;
  const msgs = current?.msgs ?? [];
  useEffect(() => {   // keep the newest message in view inside the message pane
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy, active]);

  /** Append a message to a chat and move that chat to the top of the list. */
  const push = (id: string, m: Msg, title?: string) => setChats((list) => {
    const existing = list.find((c) => c.id === id);
    const chat: Conversation = existing
      ? { ...existing, msgs: [...existing.msgs, m], updated: Date.now() }
      : { id, title: title ?? "New chat", updated: Date.now(), msgs: [m] };
    return [chat, ...list.filter((c) => c.id !== id)];
  });

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const id = active ?? newId();
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    if (!active) setActive(id);
    push(id, { role: "user", text }, text.length > 60 ? text.slice(0, 57) + "…" : text);
    setQ(""); setBusy(true);
    try {
      const r = await post<Reply>("/api/agent", { question: text, history, region: region?.key });
      push(id, { role: "assistant", text: r.answer, tools: r.tools, trace: r.trace, charts: r.charts, model: r.model, grounding: r.grounding });
    } catch (e) {
      push(id, { role: "assistant", text: `Could not reach the agent: ${(e as Error).message}` });
    } finally { setBusy(false); }
  }

  const remove = (id: string) => {
    setChats((list) => list.filter((c) => c.id !== id));
    if (id === active) setActive(null);
  };
  const clearAll = () => { if (confirm("Delete all saved chats in this browser?")) { setChats([]); setActive(null); } };

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      <header className="mb-5 flex items-end justify-between gap-6 border-b border-rule pb-4">
        <div>
          <h1 className="text-[26px] font-extrabold leading-none tracking-tight">Ask the grid analyst</h1>
          <p className="mt-2 text-[14px] text-muted">Questions about ERCOT demand, answered from the project&apos;s data and models.</p>
        </div>
        <div className="flex items-start gap-5">
        <RegionPicker region={region} onChange={setRegion} />
        <details className="relative text-[13px]">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-muted hover:text-ink"><Info size={15} /> How it works</summary>
          <div className="absolute right-0 z-10 mt-2 w-80 rounded-md border border-rule bg-panel p-4 leading-relaxed shadow-lg">
            The model answers only by calling tools over the project&apos;s data: load history, weather, forecasts,
            what-if scenarios, rankings, error breakdowns and the peak alert. Every number is checked against the tool
            results (the badge under each answer), and &ldquo;How I got this&rdquo; shows each call. With a region set, answers
            cover your region only unless you ask about another. Chats and your region are saved in this browser only.
          </div>
        </details>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <History chats={chats} active={active} onOpen={(id) => { if (!busy) setActive(id); }} onDelete={remove}
          onNew={() => { if (!busy) setActive(null); }} onClear={clearAll} />

        <section className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="flex-1 overflow-y-auto pr-2">
            {msgs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-heat-soft"><Zap size={20} className="text-heat" /></div>
                <div className="text-[18px] font-semibold">{region ? `What's happening in ${region.name}?` : "What would you like to know?"}</div>
                <p className="mt-1 max-w-[56ch] text-[14px] text-muted">{region
                  ? `Answers cover ${region.name} (${region.cities}) unless you ask about another region.`
                  : "Set your region (top right) to get briefings and answers for your area only. Data covers 2018 to Nov 2026."}</p>
                {region && (
                  <div className="mt-5 flex w-full max-w-[720px] flex-wrap items-center justify-between gap-3 rounded-lg border border-heat bg-heat-soft/50 px-5 py-4 text-left">
                    <div>
                      <div className="text-[15px] font-semibold">Regional briefing</div>
                      <div className="text-[13px] text-muted">What&apos;s important in {region.name} that day, and what to do about it.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="date" value={briefDate} min={range.start} max={range.end} onChange={(e) => setBriefDate(e.target.value)}
                        aria-label="Briefing date" className="rounded-md border border-rule bg-panel px-2 py-1.5 text-[14px]" />
                      <button onClick={() => send(`Brief me on ${region.name} for ${briefDate}: what's important and what should I do?`)}
                        className="rounded-md bg-heat px-4 py-2 text-[14px] font-semibold text-white">Brief me</button>
                    </div>
                  </div>
                )}
                <div className="mt-4 grid w-full max-w-[720px] gap-2 sm:grid-cols-2">
                  {(region ? regionStarters(region.name) : starters).map((st) => (
                    <button key={st} onClick={() => send(st)}
                      className="rounded-lg border border-rule bg-panel px-4 py-3 text-left text-[14px] transition-colors hover:border-ink">{st}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-[860px] flex-col gap-5 py-2">
                {msgs.map((m, i) => (
                  <motion.div key={`${active}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                    className={m.role === "user" ? "max-w-[75%] self-end rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-[15px] text-paper"
                      : "w-full rounded-2xl rounded-tl-sm border border-rule bg-panel px-5 py-4 text-[15px] leading-relaxed"}>
                    {m.role === "user" ? m.text : <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{m.text}</ReactMarkdown>}
                    {m.grounding && <GroundingBadge g={m.grounding} />}
                    {m.charts?.slice(0, 2).map((c, j) => <MiniChart key={j} c={c} />)}
                    {m.role === "assistant" && (() => { const b = briefingOf(m.trace); return b ? <EmailBriefing zone={b.zone} date={b.date} /> : null; })()}
                    {m.trace && <Trace steps={m.trace} model={m.model} />}
                  </motion.div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2 self-start rounded-2xl rounded-tl-sm border border-rule bg-panel px-4 py-3 text-[14px] text-muted">
                    <span className="flex gap-1">{[0, 1, 2].map((d) => (
                      <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-muted" animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }} />))}</span>
                    calling tools
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="mx-auto mt-3 flex w-full max-w-[860px] items-end gap-2 rounded-2xl border border-rule bg-panel p-2 shadow-sm focus-within:border-ink">
            <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={1}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q); } }}
              placeholder={msgs.length ? "Ask a follow-up…" : "Ask about any zone, day or scenario…"}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none focus-visible:outline-none" aria-label="question" />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-heat text-white transition-opacity disabled:opacity-40">
              <ArrowUp size={18} />
            </button>
          </form>
          <div className="mt-1.5 text-center text-[11px] text-muted">Enter to send · Shift+Enter for a new line · answers can be wrong; check the numbers badge</div>
        </section>
      </div>
    </div>
  );
}
