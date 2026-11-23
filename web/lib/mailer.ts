/**
 * Shared email safeguards for every route that emails a visitor-chosen address:
 * approved recipients only, a per-visitor rate limit, and one sending path.
 *
 * Env: ALERT_SMTP_USER / ALERT_SMTP_PASS (+ optional ALERT_SMTP_HOST / ALERT_SMTP_PORT),
 *      BRIEF_ALLOWED_TO and/or BRIEF_ALLOWED_DOMAINS (comma-separated).
 */
import nodemailer from "nodemailer";

export const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

export function allowed(to: string) {
  const addr = to.toLowerCase(), domain = addr.split("@")[1] ?? "";
  return list(process.env.BRIEF_ALLOWED_TO).includes(addr) || list(process.env.BRIEF_ALLOWED_DOMAINS).includes(domain);
}

// Per visitor, shared by all email routes: 10 an hour (auto-emailed briefings count too).
// In memory, so it resets on a cold start: a speed bump, not a wall.
const sent = new Map<string, number[]>();
const LIMIT = 10;
function overLimit(key: string) {
  const now = Date.now(), recent = (sent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= LIMIT) return true;
  sent.set(key, [...recent, now]);
  return false;
}

/** Returns an error Response if this visitor may not email this address now, otherwise null. */
export function checkRecipient(req: Request, addr: string): Response | null {
  if (!EMAIL.test(addr)) return Response.json({ ok: false, error: "That doesn't look like an email address." }, { status: 400 });
  if (!allowed(addr)) return Response.json({ ok: false, error: "This address isn't on the approved list. Ask the site owner to add it." }, { status: 403 });
  if (!process.env.ALERT_SMTP_USER || !process.env.ALERT_SMTP_PASS)
    return Response.json({ ok: false, error: "Email isn't set up on this site yet (missing ALERT_SMTP_USER / ALERT_SMTP_PASS)." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (overLimit(ip)) return Response.json({ ok: false, error: "Too many emails from here in the last hour; try again later." }, { status: 429 });
  return null;
}

export async function send(mail: { to: string; subject: string; text: string; html: string }): Promise<Response> {
  const user = process.env.ALERT_SMTP_USER!, pass = process.env.ALERT_SMTP_PASS!;
  const port = Number(process.env.ALERT_SMTP_PORT ?? 465);
  try {
    const t = nodemailer.createTransport({ host: process.env.ALERT_SMTP_HOST ?? "smtp.gmail.com", port, secure: port === 465, auth: { user, pass } });
    await t.sendMail({ from: `ERCOT grid analyst <${user}>`, ...mail });
    return Response.json({ ok: true, to: mail.to, subject: mail.subject });
  } catch (e) {
    return Response.json({ ok: false, error: `Sending failed: ${(e as Error).message}` }, { status: 502 });
  }
}
