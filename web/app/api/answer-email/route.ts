/**
 * Email any agent answer (not just briefings) to one approved address, on request.
 * Unlike briefings, this carries the model's written answer, so the email says so and includes
 * the grounding result and the tools used. Safeguards: lib/mailer.ts.
 */
import { checkRecipient, send } from "@/lib/mailer";

export const maxDuration = 30;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Small, safe Markdown subset: escape everything first, then bold, bullet and numbered lists, paragraphs.
 *  Tables are kept as monospaced text. */
function mdToHtml(md: string) {
  const blocks = md.replace(/\r/g, "").split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split("\n");
    const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if (lines.every((l) => l.trim().startsWith("|")))
      return `<pre style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#f6f7f4;padding:10px;border-radius:6px;overflow:auto">${esc(b)}</pre>`;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
      return `<ul style="padding-left:20px;margin:8px 0">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
      return `<ol style="padding-left:20px;margin:8px 0">${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    return `<p style="margin:8px 0">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { to?: string; question?: string; answer?: string; tools?: string[]; grounding?: { checked: number; ungrounded: string[] } };
  const addr = String(body.to ?? "").trim();
  const question = String(body.question ?? "").slice(0, 500);
  const answer = String(body.answer ?? "").slice(0, 6000);
  if (!answer.trim()) return Response.json({ ok: false, error: "Nothing to email." }, { status: 400 });
  const blocked = checkRecipient(req, addr);
  if (blocked) return blocked;

  const tools = (Array.isArray(body.tools) ? body.tools : []).map(String).slice(0, 12);
  const g = body.grounding;
  const check = !g || !g.checked ? "No numbers to check."
    : g.ungrounded?.length ? `${g.ungrounded.length} of ${g.checked} numbers could not be traced to the tool results: ${g.ungrounded.join(", ")}.`
    : `All ${g.checked} numbers were traced to the tool results.`;
  const origin = new URL(req.url).origin;
  const subject = `Grid analyst: ${question.length > 70 ? question.slice(0, 67) + "…" : question || "your answer"}`;
  const text = [`Question: ${question}`, "", answer, "", `Check: ${check}`, tools.length ? `Tools used: ${tools.join(", ")}` : "",
    "", "Written by the grid analyst's language model from the project's tools. Open the app to see the full tool trace:", `${origin}/analyst`].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#13202e">
<div style="background:#13202e;color:#f6f7f4;padding:12px 16px;font-weight:bold">Grid analyst answer</div>
<p style="color:#4f5f6f;margin:16px 0 4px">You asked</p><p style="margin:0 0 12px;font-weight:bold">${esc(question)}</p>
<div style="border-left:3px solid #1c5ba6;padding-left:14px">${mdToHtml(answer)}</div>
<p style="margin-top:16px;font-size:13px;color:${g?.ungrounded?.length ? "#a8441c" : "#14706a"}">${esc(check)}</p>
${tools.length ? `<p style="font-size:13px;color:#4f5f6f">Tools used: ${esc(tools.join(", "))}</p>` : ""}
<p style="color:#77818b;font-size:12px">Written by the grid analyst's language model from the project's tools (ML 6302). <a href="${esc(origin)}/analyst" style="color:#1c5ba6">Open the app</a> to see the full tool trace.</p></div>`;
  return send({ to: addr, subject, text, html });
}
