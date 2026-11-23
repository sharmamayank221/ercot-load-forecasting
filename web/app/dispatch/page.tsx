"use client";
import { useState } from "react";
import { Send, Eye } from "lucide-react";
import { PageTitle, Section, Field, inputCls } from "@/components/ui";

type Row = { zone: string; recipients: string[]; level?: string; status: string; detail: string };
type Result = { ok: boolean; error?: string; date?: string; mode?: string; dryRun?: boolean; emails_sent?: number; zones?: Row[] };

const LEVEL: Record<string, string> = { ALERT: "var(--heat)", WATCH: "#c9a227", NORMAL: "var(--cool)" };
const STATUS: Record<string, string> = { sent: "#14706a", "would send": "#1c5ba6", skipped: "var(--muted)", "no data": "var(--muted)", failed: "#a8441c" };

/** Owner-only page: preview and send each zone's briefing to that zone's subscribers. Not linked from the nav. */
export default function Dispatch() {
  const [secret, setSecret] = useState("");
  const [date, setDate] = useState("2026-08-18");
  const [mode, setMode] = useState<"alerts" | "all">("alerts");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function run(dryRun: boolean) {
    if (!dryRun && !confirm(`Email every subscribed zone's briefing for ${date}${mode === "alerts" ? " (notable zones only)" : ""}?`)) return;
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/dispatch", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ date, mode, dryRun }) });
      setRes(await r.json());
    } catch (e) { setRes({ ok: false, error: (e as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageTitle sub="Each zone's subscribers get that zone's briefing. In “notable only” mode a zone is emailed only when its briefing flags something: a grid alert or watch, demand well above normal for the month, extreme heat or a freeze. Subscriber lists are set in the ZONE_SUBSCRIBERS environment variable.">Zone email dispatch</PageTitle>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Dispatch secret"><input type="password" className={inputCls} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></Field>
        <Field label="Briefing date"><input type="date" className={inputCls} value={date} min="2025-01-01" max="2026-11-04" onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Send to">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "alerts" | "all")}>
            <option value="alerts">Notable zones only</option><option value="all">Every subscribed zone</option>
          </select>
        </Field>
        <button disabled={busy || !secret} onClick={() => run(true)} className="flex items-center gap-2 rounded-md border border-ink px-4 py-2 text-[15px] font-semibold disabled:opacity-40"><Eye size={16} /> Preview</button>
        <button disabled={busy || !secret} onClick={() => run(false)} className="flex items-center gap-2 rounded-md bg-heat px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-40"><Send size={16} /> Send</button>
      </div>

      {busy && <div className="mt-8 text-[14px] text-muted">Running briefings…</div>}
      {res && !res.ok && <div className="mt-8 rounded-md border border-heat bg-heat-soft px-4 py-3 text-[14px]">{res.error}</div>}
      {res?.ok && (
        <Section title={res.dryRun ? `Preview for ${res.date}: nothing has been sent` : `Sent for ${res.date}: ${res.emails_sent} email${res.emails_sent === 1 ? "" : "s"}`}
          aside={res.mode === "alerts" ? "notable zones only" : "every subscribed zone"}>
          <table className="w-full text-[14px]">
            <thead className="text-left text-muted"><tr><th className="py-2 font-medium">Zone</th><th className="font-medium">Level</th><th className="font-medium">Status</th><th className="font-medium">Subscribers</th><th className="font-medium">Why</th></tr></thead>
            <tbody>
              {res.zones!.map((z) => (
                <tr key={z.zone} className="border-t border-rule align-top">
                  <td className="py-2.5 pr-4 font-semibold">{z.zone}</td>
                  <td className="pr-4"><span className="font-semibold" style={{ color: LEVEL[z.level ?? ""] ?? "var(--muted)" }}>{z.level ?? "—"}</span></td>
                  <td className="pr-4 font-semibold" style={{ color: STATUS[z.status] }}>{z.status}</td>
                  <td className="pr-4 text-muted">{z.recipients.join(", ")}</td>
                  <td className="text-muted">{z.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
