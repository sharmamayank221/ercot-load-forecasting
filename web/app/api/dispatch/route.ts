/**
 * Zone dispatcher: for each zone that has subscribers, run that zone's briefing and email its subscribers
 * based on the result.
 *
 * Who gets what is decided entirely by code: the subscriber lists you configure, and the briefing's own
 * flags (grid alert/watch, unusual demand, extreme heat or freeze). No model is involved.
 *
 * Vercel environment variables:
 *   ZONE_SUBSCRIBERS   JSON, zone key -> list of emails, e.g.
 *                      {"northC":["a@mavs.uta.edu"],"coast":["b@mavs.uta.edu","c@gmail.com"]}
 *                      zone keys: northC coast southC southern east north west farWest
 *   CRON_SECRET        required; requests must send "Authorization: Bearer <CRON_SECRET>"
 *                      (Vercel Cron adds this header automatically when CRON_SECRET is set)
 *   ALERT_SMTP_USER / ALERT_SMTP_PASS (+ optional ALERT_SMTP_HOST / ALERT_SMTP_PORT)   sender, as for briefings
 *   DISPATCH_MODE      optional default: "alerts" (send only notable zones) or "all"
 *
 * Call: GET or POST /api/dispatch with date=YYYY-MM-DD, mode=alerts|all, dryRun=true to preview without sending.
 * Without a date it uses today (Central time): until the data is refreshed daily, today has no forecast and
 * nothing is sent.
 */
import nodemailer from "nodemailer";
import { makeTools } from "@/lib/agentTools";
import { REGIONS, regionByKey } from "@/lib/region";
import { render, type Brief } from "@/lib/briefEmail";

export const maxDuration = 60;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const mask = (e: string) => { const [u, d] = e.split("@"); return `${u.slice(0, 1)}${"*".repeat(Math.max(u.length - 1, 2))}@${d}`; };
const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function subscribers(): { ok: true; subs: [string, string[]][] } | { ok: false; error: string } {
  const raw = process.env.ZONE_SUBSCRIBERS;
  if (!raw) return { ok: false, error: "No subscribers configured: set ZONE_SUBSCRIBERS." };
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(raw); } catch { return { ok: false, error: "ZONE_SUBSCRIBERS is not valid JSON." }; }
  const subs: [string, string[]][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!regionByKey(k)) return { ok: false, error: `Unknown zone key "${k}". Use: ${REGIONS.map((r) => r.key).join(", ")}.` };
    const list = (Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL.test(x));
    if (list.length) subs.push([k, [...new Set(list)]]);
  }
  return { ok: true, subs };
}

type Row = { zone: string; recipients: string[]; level?: string; status: "sent" | "would send" | "skipped" | "no data" | "failed"; detail: string };

async function run(req: Request, p: Record<string, unknown>) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "Dispatch is disabled until CRON_SECRET is set." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Not authorised." }, { status: 401 });

  const s = subscribers();
  if (!s.ok) return Response.json({ ok: false, error: s.error }, { status: 400 });
  const date = String(p.date || todayCentral());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  const mode = String(p.mode || process.env.DISPATCH_MODE || "alerts") === "all" ? "all" : "alerts";
  const dryRun = p.dryRun === true || p.dryRun === "true";

  const user = process.env.ALERT_SMTP_USER, pass = process.env.ALERT_SMTP_PASS;
  if (!dryRun && (!user || !pass)) return Response.json({ ok: false, error: "Email isn't set up (ALERT_SMTP_USER / ALERT_SMTP_PASS)." }, { status: 503 });
  const port = Number(process.env.ALERT_SMTP_PORT ?? 465);
  const transport = dryRun ? null : nodemailer.createTransport({ host: process.env.ALERT_SMTP_HOST ?? "smtp.gmail.com", port, secure: port === 465, auth: { user: user!, pass: pass! } });

  const origin = new URL(req.url).origin;
  const { impl } = makeTools(origin);
  const rows: Row[] = [];
  for (const [key, emails] of s.subs) {
    const region = regionByKey(key)!;
    const shown = emails.map(mask);
    const b = (await impl.region_briefing({ zone: region.name, date })) as unknown as Brief & { notable?: boolean; error?: string };
    if (b.error) { rows.push({ zone: region.name, recipients: shown, status: "no data", detail: b.error }); continue; }
    const why = b.notable ? b.important.join(" ") : "Nothing notable in this zone.";
    if (mode === "alerts" && !b.notable) { rows.push({ zone: region.name, recipients: shown, level: b.grid_alert_level, status: "skipped", detail: why }); continue; }
    if (dryRun) { rows.push({ zone: region.name, recipients: shown, level: b.grid_alert_level, status: "would send", detail: why }); continue; }
    const { subject, text, html } = render(b, origin);
    try {
      // one email per zone, subscribers in Bcc so they never see each other's addresses
      await transport!.sendMail({ from: `ERCOT grid analyst <${user}>`, to: user, bcc: emails, subject, text, html });
      rows.push({ zone: region.name, recipients: shown, level: b.grid_alert_level, status: "sent", detail: why });
    } catch (e) {
      rows.push({ zone: region.name, recipients: shown, level: b.grid_alert_level, status: "failed", detail: (e as Error).message });
    }
  }
  const sent = rows.filter((r) => r.status === "sent").reduce((n, r) => n + r.recipients.length, 0);
  return Response.json({ ok: true, date, mode, dryRun, emails_sent: sent, zones: rows });
}

export async function GET(req: Request) {
  return run(req, Object.fromEntries(new URL(req.url).searchParams));
}
export async function POST(req: Request) {
  return run(req, (await req.json().catch(() => ({}))) as Record<string, unknown>);
}
