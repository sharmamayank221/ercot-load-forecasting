/**
 * Email a regional briefing.
 *
 * The email is built from the region_briefing tool's output (the same numbers, flags and recommendations
 * the agent summarised), never from model-written text, and goes only to approved recipients.
 *
 * Vercel environment variables:
 *   ALERT_SMTP_USER, ALERT_SMTP_PASS        Gmail address and its 16-character app password (sender)
 *   ALERT_SMTP_HOST, ALERT_SMTP_PORT        optional, default smtp.gmail.com / 465
 *   BRIEF_ALLOWED_TO                        comma-separated addresses allowed to receive briefings
 *   BRIEF_ALLOWED_DOMAINS                   comma-separated domains allowed, e.g. mavs.uta.edu
 */
import nodemailer from "nodemailer";
import { makeTools } from "@/lib/agentTools";
import { regionByKey } from "@/lib/region";
import { render, type Brief } from "@/lib/briefEmail";

export const maxDuration = 30;

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function allowed(to: string) {
  const addr = to.toLowerCase(), domain = addr.split("@")[1] ?? "";
  return list(process.env.BRIEF_ALLOWED_TO).includes(addr) || list(process.env.BRIEF_ALLOWED_DOMAINS).includes(domain);
}

// Per-visitor limit: 5 emails an hour. In memory, so it resets when the function cold-starts: a speed bump, not a wall.
const sent = new Map<string, number[]>();
function overLimit(key: string) {
  const now = Date.now(), recent = (sent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 5) return true;
  sent.set(key, [...recent, now]);
  return false;
}

export async function POST(req: Request) {
  const { zone, date, to } = (await req.json().catch(() => ({}))) as { zone?: string; date?: string; to?: string };
  const region = regionByKey(zone ?? "");
  const addr = String(to ?? "").trim();
  if (!region || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return Response.json({ ok: false, error: "Pick a region and a date first." }, { status: 400 });
  if (!EMAIL.test(addr)) return Response.json({ ok: false, error: "That doesn't look like an email address." }, { status: 400 });
  if (!allowed(addr)) return Response.json({ ok: false, error: "This address isn't on the approved list for briefings. Ask the site owner to add it." }, { status: 403 });
  const user = process.env.ALERT_SMTP_USER, pass = process.env.ALERT_SMTP_PASS;
  if (!user || !pass) return Response.json({ ok: false, error: "Email isn't set up on this site yet (missing ALERT_SMTP_USER / ALERT_SMTP_PASS)." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (overLimit(ip)) return Response.json({ ok: false, error: "Too many emails from here in the last hour; try again later." }, { status: 429 });

  const origin = new URL(req.url).origin;
  const { impl } = makeTools(origin);
  const b = (await impl.region_briefing({ zone: region.name, date })) as unknown as Brief & { error?: string };
  if (b.error) return Response.json({ ok: false, error: b.error }, { status: 400 });
  const { subject, text, html } = render(b, origin);
  const port = Number(process.env.ALERT_SMTP_PORT ?? 465);
  try {
    const transport = nodemailer.createTransport({ host: process.env.ALERT_SMTP_HOST ?? "smtp.gmail.com", port, secure: port === 465, auth: { user, pass } });
    await transport.sendMail({ from: `ERCOT grid analyst <${user}>`, to: addr, subject, text, html });
    return Response.json({ ok: true, to: addr, subject });
  } catch (e) {
    return Response.json({ ok: false, error: `Sending failed: ${(e as Error).message}` }, { status: 502 });
  }
}
