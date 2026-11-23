"""Peak-demand email alert for the ERCOT project.

Forecasts the ERCOT system load for one day with the trained model (sum of the 8 zone
forecasts), compares the forecast peak with that day's high-peak cutoff, and emails a
short briefing. The decision to alert is made by plain code; the optional LLM only writes
the summary sentence, from numbers it is given.

Put this file at  src/alerts/peak_alert.py  (with an empty src/alerts/__init__.py), then:

  python -m src.alerts.peak_alert --date 2026-07-22                 # dry run: print the email
  python -m src.alerts.peak_alert --date 2026-07-22 --send          # send only if WATCH/ALERT
  python -m src.alerts.peak_alert --date 2026-07-22 --send --always # send whatever the level
  python -m src.alerts.peak_alert --backtest 2026-06-01 2026-08-31  # how good is the alert rule?

Settings in .env (never commit it):
  ALERT_SMTP_HOST=smtp.gmail.com
  ALERT_SMTP_PORT=465
  ALERT_SMTP_USER=you@gmail.com
  ALERT_SMTP_PASS=xxxx xxxx xxxx xxxx     # Gmail *app password*, not your account password
  ALERT_TO=you@gmail.com                  # comma-separated; recipients come only from here
  ALERT_USE_LLM=0                         # 1 = local agent (Ollama) writes the summary sentence
  ALERT_WATCH_PCT=3                       # WATCH when the forecast is within 3% of the cutoff
  ALERT_ZONE=North Central                # optional: email only this region's details (or pass --zone)

Note: forecasts need that day's features (weather + load lags) in the feature table, so today
this works for any date already in the data (a "replay"). A live "tomorrow" alert needs a
daily refresh step first: pull the latest load from the ERCOT API and a weather forecast.
"""
import argparse
import os
import smtplib
import ssl
from email.message import EmailMessage

import numpy as np
import pandas as pd

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from src.config import PEAK_TABLE
from src.agent import tools as T

ZONES = list(T.ZONE_NAMES.values())


# ------------------------------------------------------------------ forecast + decision
def system_forecast(date):
    """Hourly system forecast (sum of zones), actuals if the day is in the past, per-zone detail."""
    fc_total, act_total, zones = None, None, []
    for z in ZONES:
        f = T.forecast_load(z, date)
        rows = T._day_rows(T._zone(z), date)
        w = T.get_weather(z, date)
        fc = np.array(f["hourly_mw"], dtype=float)
        act = rows["load_mw"].to_numpy(dtype=float)
        fc_total = fc if fc_total is None else fc_total + fc
        act_total = act if act_total is None else act_total + act
        zones.append({"zone": z, "peak_mw": f["peak_mw"], "peak_hour": f["peak_hour"],
                      "temp_high_f": w["temp_high_f"]})
    hours = T._day_rows("northC", date)["hour"].to_numpy()
    i = int(fc_total.argmax())
    return {"date": str(pd.Timestamp(date).date()), "hourly_mw": fc_total.round().tolist(),
            "peak_mw": float(fc_total.max()), "peak_hour": int(hours[i]),
            "actual_peak_mw": float(act_total.max()) if np.isfinite(act_total).all() else None,
            "zones": sorted(zones, key=lambda r: -r["peak_mw"])}


def cutoff_for(date):
    """High-peak cutoff in MW: the day's own cutoff if labelled, else the latest one for that month."""
    p = pd.read_parquet(PEAK_TABLE)
    day = pd.Timestamp(date).normalize()
    row = p[p.day == day]
    if len(row):
        r = row.iloc[0]
        return float(r.cutoff_mw), bool(r.high_peak)
    same_month = p[p.month == day.month]
    ratio = same_month.cutoff_ratio.iloc[-1]
    return float(ratio * p.trail_mean_mw.iloc[-1]), None


def assess(date):
    f = system_forecast(date)
    cutoff, actual_label = cutoff_for(date)
    margin = f["peak_mw"] / cutoff - 1
    watch = float(os.environ.get("ALERT_WATCH_PCT", 3)) / 100
    level = "ALERT" if margin >= 0 else "WATCH" if margin >= -watch else "NORMAL"
    return {**f, "cutoff_mw": cutoff, "margin_pct": margin * 100, "level": level,
            "actual_high_peak": actual_label}


# ------------------------------------------------------------------ email
def summary_sentence(a):
    text = (f"Forecast system peak {a['peak_mw']:,.0f} MW at {a['peak_hour']}:00, "
            f"{abs(a['margin_pct']):.1f}% {'above' if a['margin_pct'] >= 0 else 'below'} "
            f"the high-peak cutoff of {a['cutoff_mw']:,.0f} MW.")
    if os.environ.get("ALERT_USE_LLM") != "1":
        return text
    try:
        from src.agent.agent import build_llm
        prompt = ("Write two plain sentences for grid planners. Use ONLY these figures, do not add "
                  f"any other number. Date {a['date']}. Level {a['level']}. {text} "
                  f"Hottest zone: {a['zones'][0]['zone']} at {a['zones'][0]['temp_high_f']:.0f}°F.")
        return build_llm().invoke(prompt).content.strip()
    except Exception:                      # never let the LLM block the alert
        return text


def build_email(a, zone=None):
    """zone: if set, the email covers that region only (plus the grid-wide alert level, which is system-wide)."""
    level = a["level"]
    if zone:
        a = {**a, "zones": [z for z in a["zones"] if z["zone"].lower() == zone.lower()]}
        if not a["zones"]:
            raise SystemExit(f"unknown zone {zone!r}; use one of: {', '.join(ZONES)}")
    subj = (f"[ERCOT {level}] {a['date']}: forecast peak {a['peak_mw']:,.0f} MW "
            f"({a['margin_pct']:+.1f}% vs cutoff)")
    if zone:
        z = a["zones"][0]
        subj = f"[ERCOT {level}] {a['date']} · {z['zone']}: peak {z['peak_mw']:,} MW at {z['peak_hour']}:00"
    lines = [summary_sentence(a), ""]
    if zone:
        z = a["zones"][0]
        lines += [f"Your region, {z['zone']}: forecast peak {z['peak_mw']:,} MW around {z['peak_hour']}:00, "
                  f"high of {z['temp_high_f']:.0f}°F.", ""]
    if a["actual_peak_mw"]:
        lines.append(f"Replay of a past day: the actual peak was {a['actual_peak_mw']:,.0f} MW"
                     + (f"; it {'was' if a['actual_high_peak'] else 'was not'} a high-peak day."
                        if a["actual_high_peak"] is not None else "."))
        lines.append("")
    lines.append(f"{'Zone':<15}{'Peak MW':>10}{'Hour':>6}{'Temp high':>11}")
    for z in a["zones"]:
        lines.append(f"{z['zone']:<15}{z['peak_mw']:>10,}{z['peak_hour']:>5}:00{z['temp_high_f']:>9.0f}°F")
    lines += ["", "Generated by the ERCOT load forecasting project. Forecasts use observed weather "
              "for past days; treat them as decision support, not an operational forecast."]
    body = "\n".join(lines)

    colour = {"ALERT": "#e6612a", "WATCH": "#c9a227", "NORMAL": "#1f9e96"}[level]
    rows = "".join(f"<tr><td>{z['zone']}</td><td align=right>{z['peak_mw']:,}</td>"
                   f"<td align=right>{z['peak_hour']}:00</td><td align=right>{z['temp_high_f']:.0f}°F</td></tr>"
                   for z in a["zones"])
    html = f"""<div style="font-family:Arial,sans-serif;max-width:560px">
<div style="background:{colour};color:#fff;padding:10px 14px;font-weight:bold">{level}: {a['date']}</div>
<p style="font-size:15px">{lines[0]}</p>
{f"<p style='color:#555'>{lines[2]}</p>" if a["actual_peak_mw"] else ""}
<table cellpadding="4" style="border-collapse:collapse;font-size:14px">
<tr style="border-bottom:1px solid #ccc"><th align=left>Zone</th><th>Peak MW</th><th>Hour</th><th>Temp high</th></tr>
{rows}</table>
<p style="color:#777;font-size:12px">Generated by the ERCOT load forecasting project. Decision support, not an operational forecast.</p></div>"""
    return subj, body, html


def send(subject, body, html):
    to = [t.strip() for t in os.environ.get("ALERT_TO", "").split(",") if t.strip()]
    user, pw = os.environ.get("ALERT_SMTP_USER"), os.environ.get("ALERT_SMTP_PASS")
    if not (to and user and pw):
        raise SystemExit("Set ALERT_SMTP_USER, ALERT_SMTP_PASS and ALERT_TO in .env first.")
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, ", ".join(to)
    msg.set_content(body)
    msg.add_alternative(html, subtype="html")
    host = os.environ.get("ALERT_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("ALERT_SMTP_PORT", 465))
    with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context()) as s:
        s.login(user, pw)
        s.send_message(msg)
    print(f"sent to {', '.join(to)}")


# ------------------------------------------------------------------ backtest
def backtest(start, end):
    """Run the alert rule over past days and compare with the actual high-peak labels."""
    rows = []
    for d in pd.date_range(start, end, freq="D"):
        try:
            a = assess(str(d.date()))
        except ValueError:
            continue
        rows.append({"date": a["date"], "level": a["level"], "forecast_peak": round(a["peak_mw"]),
                     "actual_peak": round(a["actual_peak_mw"] or 0), "cutoff": round(a["cutoff_mw"]),
                     "actual_high_peak": a["actual_high_peak"]})
        print(f"{a['date']}  {a['level']:<6} forecast {a['peak_mw']:>9,.0f}  cutoff {a['cutoff_mw']:>9,.0f}"
              f"  actual {'HIGH' if a['actual_high_peak'] else '-'}")
    df = pd.DataFrame(rows).dropna(subset=["actual_high_peak"])
    if df.empty:
        return
    alert = df.level == "ALERT"
    alert_or_watch = df.level.isin(["ALERT", "WATCH"])
    truth = df.actual_high_peak.astype(bool)
    for name, flag in [("ALERT only", alert), ("ALERT or WATCH", alert_or_watch)]:
        tp = int((flag & truth).sum())
        print(f"\n{name}: caught {tp}/{int(truth.sum())} high-peak days (recall {tp / max(truth.sum(), 1):.2f}), "
              f"{int(flag.sum())} emails sent (precision {tp / max(flag.sum(), 1):.2f})")
    df.to_csv("outputs/reports/alert_backtest.csv", index=False)
    print("\nwritten to outputs/reports/alert_backtest.csv")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="day to assess, YYYY-MM-DD")
    ap.add_argument("--send", action="store_true", help="actually send (default: print only)")
    ap.add_argument("--always", action="store_true", help="send even when the level is NORMAL")
    ap.add_argument("--backtest", nargs=2, metavar=("START", "END"))
    ap.add_argument("--zone", default=os.environ.get("ALERT_ZONE"), help="email only this region, e.g. 'North Central'")
    args = ap.parse_args()
    if args.backtest:
        backtest(*args.backtest)
    elif args.date:
        a = assess(args.date)
        subject, body, html = build_email(a, args.zone)
        print(subject, "\n", "-" * len(subject), "\n", body, sep="")
        if args.send and (a["level"] != "NORMAL" or args.always):
            send(subject, body, html)
        elif args.send:
            print("\nlevel NORMAL: no email sent (use --always to send anyway)")
    else:
        ap.print_help()
