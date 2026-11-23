/**
 * Renders a regional briefing (the region_briefing tool's output) as an email, action first:
 * a one-line headline, at most three things to do, one line of why, and three key numbers.
 * Shared by /api/brief-email (one recipient) and /api/dispatch (each zone's subscribers).
 * Layout uses tables and inline styles so it holds up in Gmail and Outlook.
 */
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const num = (v: number) => v.toLocaleString("en-US");

export type Brief = {
  region: string; date: string; grid_alert_level: string; forecast_peak_mw: number; peak_hour: number; peak_window: string;
  typical_peak_this_month_mw: number | null; vs_typical_pct: number | null; temp_high_f: number; temp_low_f: number;
  important: string[]; recommendations: string[]; actual_peak_mw?: number;
};

const LEVEL = {
  ALERT: { color: "#d9541f", soft: "#fdeee7", label: "Grid alert" },
  WATCH: { color: "#b8860b", soft: "#fbf4e0", label: "Grid watch" },
  NORMAL: { color: "#1f8f88", soft: "#e6f4f3", label: "Normal day" },
} as const;

function headline(b: Brief) {
  const w = b.peak_window;
  if (b.grid_alert_level === "ALERT") return `High grid demand: ease off ${w}`;
  if (b.grid_alert_level === "WATCH") return `Demand near the grid's limit: ease off ${w} if you can`;
  if (b.temp_high_f >= 100) return `No grid stress, but extreme heat (${b.temp_high_f} °F)`;
  if (b.temp_low_f <= 32) return `No grid stress, but freezing overnight (${b.temp_low_f} °F)`;
  if ((b.vs_typical_pct ?? 0) >= 10) return `Busier than usual in ${b.region}`;
  return "A normal day: no action needed";
}

/** Up to three actions, most useful first; the "watch for appeals" line becomes a footnote. */
function actions(b: Brief) {
  const appeal = b.recommendations.filter((r) => /conservation appeals/i.test(r));
  const rest = b.recommendations.filter((r) => !/conservation appeals/i.test(r));
  return { top: rest.slice(0, 3), footnote: appeal[0] };
}

function why(b: Brief) {
  const month = new Date(`${b.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const parts = [
    b.grid_alert_level === "ALERT" ? "Texas grid forecast above its high-peak threshold"
      : b.grid_alert_level === "WATCH" ? "Texas grid forecast just under its high-peak threshold" : "Texas grid demand normal",
  ];
  if (b.vs_typical_pct != null && Math.abs(b.vs_typical_pct) >= 5)
    parts.push(`${b.region} ${b.vs_typical_pct > 0 ? "+" : ""}${b.vs_typical_pct}% vs a typical ${month} day`);
  if (b.temp_high_f >= 100) parts.push(`${b.temp_high_f} °F high`);
  if (b.temp_low_f <= 32) parts.push(`${b.temp_low_f} °F low`);
  return parts.join(" · ");
}

export function render(b: Brief, appUrl: string) {
  const lv = LEVEL[b.grid_alert_level as keyof typeof LEVEL] ?? LEVEL.NORMAL;
  const day = new Date(`${b.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const head = headline(b);
  const { top, footnote } = actions(b);
  const reason = why(b);
  const shortDay = new Date(`${b.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const subject = `${b.grid_alert_level === "NORMAL" ? "" : `[${b.grid_alert_level}] `}${b.region}, ${shortDay}: ${head}`;

  const text = [
    `${lv.label.toUpperCase()} · ${b.region} · ${day}`, head, "",
    ...(top.length === 1 && /^No grid stress/i.test(top[0]) ? ["NO ACTION NEEDED", top[0]] : ["DO THIS", ...top.map((a, i) => `${i + 1}. ${a}`)]),
    ...(footnote ? [`   ${footnote}`] : []), "",
    `WHY: ${reason}`, "",
    `Peak ${num(b.forecast_peak_mw)} MW around ${b.peak_hour}:00 · busiest ${b.peak_window} · high ${b.temp_high_f} °F`, "",
    `Open the analyst: ${appUrl}/analyst`,
    "ERCOT load forecasting project (ML 6302). Decision support, not an official ERCOT forecast.",
  ].join("\n");

  const stat = (label: string, value: string) =>
    `<td width="33%" style="padding:14px 12px;background:#f6f7f4;border-radius:8px;vertical-align:top">
       <div style="font-size:12px;color:#5b6b7b;text-transform:uppercase;letter-spacing:.06em">${esc(label)}</div>
       <div style="font-size:18px;font-weight:bold;color:#13202e;margin-top:4px">${esc(value)}</div></td>`;
  const nothingToDo = top.length === 1 && /^No grid stress/i.test(top[0]);
  const steps = nothingToDo ? `<tr><td style="padding:6px 0;font-size:17px;line-height:1.4;color:#13202e">${esc(top[0])}</td></tr>` : top.map((a, i) => `
    <tr><td width="36" valign="top" style="padding:6px 0">
      <div style="width:28px;height:28px;border-radius:14px;background:${lv.color};color:#fff;font-weight:bold;font-size:15px;line-height:28px;text-align:center">${i + 1}</div></td>
      <td valign="top" style="padding:8px 0 6px 6px;font-size:17px;line-height:1.4;color:#13202e">${esc(a)}</td></tr>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#eef0ec">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
  <tr><td style="background:${lv.color};padding:22px 28px;color:#ffffff">
    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.9">${esc(lv.label)} · ${esc(b.region)} · ${esc(day)}</div>
    <div style="font-size:24px;font-weight:bold;line-height:1.25;margin-top:6px">${esc(head)}</div></td></tr>
  <tr><td style="padding:24px 28px 8px">
    <div style="font-size:13px;font-weight:bold;letter-spacing:.08em;color:${lv.color};text-transform:uppercase">${nothingToDo ? "No action needed" : "Do this"}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px">${steps}</table>
    ${footnote ? `<div style="font-size:14px;color:#5b6b7b;margin:6px 0 0 42px">${esc(footnote)}</div>` : ""}
  </td></tr>
  <tr><td style="padding:12px 28px">
    <div style="background:${lv.soft};border-left:4px solid ${lv.color};padding:12px 14px;font-size:15px;color:#13202e;line-height:1.45">
      <b>Why:</b> ${esc(reason)}</div></td></tr>
  <tr><td style="padding:8px 22px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
      ${stat("Peak", `${num(b.forecast_peak_mw)} MW`)}${stat("Busiest", b.peak_window)}${stat("High", `${b.temp_high_f} °F`)}
    </tr></table></td></tr>
  <tr><td style="padding:18px 28px 26px">
    <a href="${esc(appUrl)}/analyst" style="display:inline-block;background:#13202e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:11px 18px;border-radius:8px">Open the grid analyst</a>
    <div style="font-size:12px;color:#8a949e;margin-top:16px;line-height:1.5">ERCOT load forecasting project (ML 6302). Based on the project's day-ahead model; decision support, not an official ERCOT forecast.</div>
  </td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
