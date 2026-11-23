/**
 * Email a regional briefing to one approved address (on request, or automatically when the visitor opted in).
 * Built from the region_briefing tool's output, never from model-written text. Safeguards: lib/mailer.ts.
 */
import { makeTools } from "@/lib/agentTools";
import { regionByKey } from "@/lib/region";
import { render, type Brief } from "@/lib/briefEmail";
import { checkRecipient, send } from "@/lib/mailer";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { zone, date, to } = (await req.json().catch(() => ({}))) as { zone?: string; date?: string; to?: string };
  const region = regionByKey(zone ?? "");
  const addr = String(to ?? "").trim();
  if (!region || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return Response.json({ ok: false, error: "Pick a region and a date first." }, { status: 400 });
  const blocked = checkRecipient(req, addr);
  if (blocked) return blocked;
  const origin = new URL(req.url).origin;
  const b = (await makeTools(origin).impl.region_briefing({ zone: region.name, date })) as unknown as Brief & { error?: string };
  if (b.error) return Response.json({ ok: false, error: b.error }, { status: 400 });
  return send({ to: addr, ...render(b, origin) });
}
