"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { post } from "@/lib/api";
import { PageTitle } from "@/components/ui";

type Msg = { role: "user" | "assistant"; text: string; tools?: string[] };
const starters = [
  "What was the North Central peak on 2026-07-22?",
  "Was 2026-07-22 a high-peak day?",
  "What happens to Coast load on 2026-08-15 if it is 5 degrees hotter?",
  "Which model is in use and how accurate is it?",
];

export default function Analyst() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text }]); setQ(""); setBusy(true);
    try {
      const r = await post<{ answer: string; tools: string[] }>("/api/agent", { question: text });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, tools: r.tools }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Could not reach the API: ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageTitle sub="A local model (Ollama) that answers by calling the project's tools: load history, weather, the forecaster, what-if scenarios and the peak-day classifier. Every number comes from a tool call, and the tools used are listed under each answer.">Ask the grid analyst</PageTitle>
      <div className="flex flex-col gap-4">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {starters.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-rule bg-panel px-4 py-2 text-left text-[14px] hover:border-ink">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className={`max-w-[70ch] rounded-lg px-4 py-3 text-[15px] leading-relaxed ${m.role === "user" ? "self-end bg-ink text-paper" : "bg-panel border border-rule"}`}>
            <div className="whitespace-pre-wrap">{m.text}</div>
            {m.tools && m.tools.length > 0 && <div className="mt-2 text-[12px] text-muted">tools: {m.tools.join(", ")}</div>}
          </motion.div>
        ))}
        {busy && <div className="text-[14px] text-muted">Calling tools…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="mt-6 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any zone and date between 2018 and Nov 2026"
          className="flex-1 rounded-md border border-rule bg-panel px-4 py-3 text-[15px]" aria-label="question" />
        <button type="submit" disabled={busy} className="rounded-md bg-heat px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-50">Ask</button>
      </form>
    </>
  );
}
