"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { post, fmt } from "@/lib/api";
import { PageTitle } from "@/components/ui";

type Chart = { title: string; hours: number[]; series: { name: string; values: number[]; kind: "actual" | "forecast" | "alt" | "naive" }[] };
type Step = { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };
type Reply = { answer: string; tools: string[]; trace?: Step[]; charts?: Chart[]; model?: string };
type Msg = { role: "user" | "assistant"; text: string; tools?: string[]; trace?: Step[]; charts?: Chart[]; model?: string };

const starters = [
  "What was the North Central peak on 2026-07-22?",
  "How far off was the forecast that day?",
  "What happens to Coast load on 2026-08-15 if it is 6 degrees hotter?",
  "Was 2026-07-22 a high-peak day?",
  "Compare the forecast error for Coast and West on 2026-02-14.",
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

export default function Analyst() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text }]); setQ(""); setBusy(true);
    try {
      const r = await post<Reply>("/api/agent", { question: text, history });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, tools: r.tools, trace: r.trace, charts: r.charts, model: r.model }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Could not reach the agent: ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageTitle sub="A language model that answers by calling the project's tools: load history, weather, the precomputed forecasts, what-if scenarios and the high-peak labels. Every number comes from a tool call; open “How I got this” under an answer to see each call and its result. Follow-up questions remember the conversation.">Ask the grid analyst</PageTitle>
      <div className="flex flex-col gap-4">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {starters.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-rule bg-panel px-4 py-2 text-left text-[14px] hover:border-ink">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className={m.role === "user" ? "max-w-[70ch] self-end rounded-lg bg-ink px-4 py-3 text-[15px] text-paper"
              : "w-full max-w-[80ch] rounded-lg border border-rule bg-panel px-4 py-3 text-[15px] leading-relaxed"}>
            {m.role === "user" ? m.text : <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{m.text}</ReactMarkdown>}
            {m.charts?.slice(0, 2).map((c, j) => <MiniChart key={j} c={c} />)}
            {m.trace && <Trace steps={m.trace} model={m.model} />}
          </motion.div>
        ))}
        {busy && <div className="text-[14px] text-muted">Calling tools…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="mt-6 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any zone; forecasts cover Jan 2025 to Nov 2026"
          className="flex-1 rounded-md border border-rule bg-panel px-4 py-3 text-[15px]" aria-label="question" />
        {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="rounded-md border border-rule px-4 py-3 text-[14px] text-muted hover:border-ink">New chat</button>}
        <button type="submit" disabled={busy} className="rounded-md bg-heat px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-50">Ask</button>
      </form>
    </>
  );
}
