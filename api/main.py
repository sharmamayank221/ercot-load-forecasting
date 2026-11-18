"""FastAPI backend for the web app.   Run:  uvicorn api.main:app --reload --port 8000"""
import json
import os
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.config import MODEL_TABLE, OUT_REPORTS, PEAK_TABLE
from src.agent import tools as T

app = FastAPI(title="ERCOT load forecasting API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
ZN = T.ZONE_NAMES


@lru_cache(maxsize=1)
def table():
    df = pd.read_parquet(MODEL_TABLE)
    return df[~df.DSTFlag].copy()


def _zone(z):
    try:
        return T._zone(z)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/summary")
def summary():
    df = table()
    s = df[df.zone == "northC"].set_index("timestamp")["system_total_mw"]
    yearly = s.groupby(s.index.year).agg(["mean", "max"]).round(0)
    lb_p = OUT_REPORTS / "leaderboard_ratio.csv"
    lb = pd.read_csv(lb_p) if lb_p.exists() else pd.DataFrame()
    test = lb[lb.split == "test"].sort_values("MAPE_pct") if len(lb) else lb
    last_day = s.index.max().normalize()
    latest = df[(df.zone == "northC") & (df.timestamp >= last_day)]
    share = df[df.timestamp.dt.year == 2026].groupby("zone").load_mw.mean()
    return {
        "hours": int(len(s)), "start": str(s.index.min().date()), "end": str(s.index.max().date()),
        "record_mw": float(s.max()), "record_time": str(s.idxmax()),
        "avg_2018": float(s["2018"].mean()), "avg_2026": float(s["2026"].mean()),
        "yearly": [{"year": int(y), "average": float(r["mean"]), "peak": float(r["max"])} for y, r in yearly.iterrows()],
        "leaderboard": [{"model": r.model, "r2": float(r.R2), "mae": float(r.MAE_MW), "mape": float(r.MAPE_pct)}
                        for r in test.itertuples()],
        "zone_share": [{"zone": ZN[z], "mw": float(v)} for z, v in share.items()],
        "latest_day": {"date": str(last_day.date()),
                       "points": [{"hour": int(h), "mw": float(m), "temp_f": float(t)}
                                  for h, m, t in zip(latest.timestamp.dt.hour, latest.system_total_mw, latest.temp_f)]},
    }


@app.get("/api/load")
def load(zone: str = "North Central", start: str = "2026-07-13", end: str = "2026-07-27"):
    z = _zone(zone)
    df = table()
    s = df[(df.zone == z) & (df.timestamp >= pd.Timestamp(start)) & (df.timestamp < pd.Timestamp(end) + pd.Timedelta(days=1))]
    if s.empty:
        raise HTTPException(404, "no data in that range")
    return {"zone": ZN[z], "points": [{"t": ts.isoformat(), "mw": float(m), "temp_f": float(t)}
                                      for ts, m, t in zip(s.timestamp, s.load_mw, s.temp_f)]}


@app.get("/api/profile")
def profile(zone: str = "North Central"):
    z = _zone(zone)
    df = table()
    d = df[df.zone == z]
    prof = d.groupby([d.timestamp.dt.month, d.timestamp.dt.hour]).load_mw.mean().unstack()
    summer = d[d.timestamp.dt.month.isin([6, 7, 8])].dropna(subset=["temp_f"])
    summer = summer.sample(min(4000, len(summer)), random_state=1)
    return {"zone": ZN[z],
            "heatmap": [{"month": int(m), "hour": int(h), "mw": float(v)} for m, row in prof.iterrows() for h, v in row.items()],
            "scatter": [{"temp_f": float(t), "mw": float(m)} for t, m in zip(summer.temp_f, summer.load_mw)]}


@app.get("/api/forecast")
def forecast(zone: str = "North Central", date: str = "2026-07-22", temp_shift_f: float = 0.0):
    try:
        f = T.forecast_load(zone, date, temp_shift_f)
        r = T._day_rows(T._zone(zone), date)
        w = T.get_weather(zone, date)
        e = T.explain(zone, date)
    except (ValueError, FileNotFoundError) as ex:
        raise HTTPException(400, str(ex))
    f["actual_mw"] = [float(v) for v in r.load_mw]
    f["naive_mw"] = [float(v) for v in r.load_lag_168h]
    f["temp_f"] = [float(v) for v in r.temp_f]
    f["weather"] = w
    f["explain"] = e
    return f


@app.get("/api/whatif")
def whatif(zone: str = "Coast", date: str = "2026-08-15", temp_shift_f: float = 5.0):
    try:
        base = T.forecast_load(zone, date, 0.0)
        shifts = list(range(-15, 16, 3))
        curve = [{"shift": s, "peak_mw": T.forecast_load(zone, date, float(s))["peak_mw"]} for s in shifts]
        alt = T.forecast_load(zone, date, temp_shift_f)
    except (ValueError, FileNotFoundError) as ex:
        raise HTTPException(400, str(ex))
    return {"zone": base["zone"], "date": base["date"], "temp_shift_f": temp_shift_f,
            "base_mw": base["hourly_mw"], "shifted_mw": alt["hourly_mw"],
            "peak_base": base["peak_mw"], "peak_shifted": alt["peak_mw"], "curve": curve}


@app.get("/api/peaks")
def peaks():
    if not PEAK_TABLE.exists():
        raise HTTPException(404, "run `make peak` first")
    p = pd.read_parquet(PEAK_TABLE)
    lb_p = OUT_REPORTS / "peak_day_leaderboard.csv"
    lb = pd.read_csv(lb_p).fillna(0).round(3).to_dict("records") if lb_p.exists() else []
    by_year = p.groupby(p.day.dt.year).high_peak.mean().mul(100).round(1)
    return {"days": [{"day": str(d.date()), "peak_mw": float(a), "cutoff_mw": float(c), "high": bool(h)}
                     for d, a, c, h in zip(p.day, p.peak_mw, p.cutoff_mw, p.high_peak)],
            "share_by_year": [{"year": int(y), "pct": float(v)} for y, v in by_year.items()],
            "classifier": lb}


class Question(BaseModel):
    question: str


@app.post("/api/agent")
def agent(q: Question):
    try:
        from src.agent.agent import ask
        answer, used = ask(q.question)
        return {"answer": answer, "tools": used}
    except Exception as ex:                      # the UI shows the message
        return {"answer": f"Agent unavailable: {ex}", "tools": []}


@app.get("/api/tools/{name}")
def run_tool(name: str, zone: str = "North Central", date: str = "2026-07-22", end: str = "2026-07-22", temp_shift_f: float = 5.0):
    fn = {"get_load": lambda: T.get_load(zone, date, end), "get_weather": lambda: T.get_weather(zone, date),
          "forecast_load": lambda: T.forecast_load(zone, date), "what_if": lambda: T.what_if(zone, date, temp_shift_f),
          "peak_risk": lambda: T.peak_risk(date), "explain": lambda: T.explain(zone, date), "model_card": T.model_card}.get(name)
    if fn is None:
        raise HTTPException(404, "unknown tool")
    try:
        return fn()
    except Exception as ex:
        return {"error": str(ex)}


@app.get("/api/eda")
def eda():
    """Everything the EDA page needs, computed once and cached."""
    return _eda()


@lru_cache(maxsize=1)
def _eda():
    import numpy as np
    df = table()
    sysd = df[df.zone == "northC"].set_index("timestamp")
    s = sysd["system_total_mw"]
    # 1 dataset facts
    facts = {"rows": int(len(df)), "hours": int(len(s)), "zones": 8, "start": str(s.index.min().date()),
             "end": str(s.index.max().date()), "missing_temp_pct": float(df.temp.isna().mean() * 100),
             "archive_rows": int((df.source == "archive").sum()), "api_rows": int((df.source == "api").sum()),
             "uri_hours": int(df[df.uri_flag].timestamp.nunique())}
    # 2 load distribution (system total)
    hist, edges = np.histogram(s, bins=40)
    dist = [{"mw": float((edges[i] + edges[i + 1]) / 2), "hours": int(h)} for i, h in enumerate(hist)]
    # 3 monthly average and spread
    g = s.groupby(s.index.month)
    monthly = [{"month": int(m), "mean": float(v.mean()), "p10": float(v.quantile(0.1)), "p90": float(v.quantile(0.9))} for m, v in g]
    # 4 weekday vs weekend daily profile (summer)
    summer = sysd[sysd.index.month.isin([6, 7, 8])]
    wk = summer[summer.index.dayofweek < 5].groupby(summer[summer.index.dayofweek < 5].index.hour)["system_total_mw"].mean()
    we = summer[summer.index.dayofweek >= 5].groupby(summer[summer.index.dayofweek >= 5].index.hour)["system_total_mw"].mean()
    profile = [{"hour": int(h), "weekday": float(wk[h]), "weekend": float(we[h])} for h in range(24)]
    # 5 temperature response by season (U-shape): bin temp, mean system load, North Central temp as proxy
    d = sysd.copy(); d["tb"] = (d.temp_f // 5 * 5)
    seasons = {"summer": [6, 7, 8], "winter": [12, 1, 2], "spring/fall": [3, 4, 5, 9, 10, 11]}
    resp = []
    for name, months in seasons.items():
        q = d[d.index.month.isin(months)].groupby("tb")["system_total_mw"].agg(["mean", "size"])
        q = q[q["size"] >= 30]
        for t, r in q.iterrows():
            resp.append({"season": name, "temp_f": float(t), "mw": float(r["mean"])})
    # 6 zone growth: average load per zone per year
    zy = df.groupby([df.timestamp.dt.year, "zone"]).load_mw.mean().unstack()
    zone_growth = [{"year": int(y), **{ZN[z]: float(v) for z, v in row.items()}} for y, row in zy.iterrows()]
    # 7 correlations of key drivers with load (North Central)
    nc = df[df.zone == "northC"].copy()
    nc["hour"] = nc.timestamp.dt.hour; nc["dow"] = nc.timestamp.dt.dayofweek
    nc["cdh"] = (nc.temp_f - 65).clip(lower=0); nc["hdh"] = (65 - nc.temp_f).clip(lower=0)
    cols = ["temp_f", "cdh", "hdh", "dwpt", "rhum", "wspd", "hour", "dow"]
    corr = [{"feature": c, "r": float(nc[[c, "load_mw"]].corr().iloc[0, 1])} for c in cols]
    # 8 Winter Storm Uri window: system load vs temperature
    uri = sysd["2021-02-10":"2021-02-22"]
    uri_pts = [{"t": ts.isoformat(), "mw": float(m), "temp_f": float(t), "shed": bool(f)}
               for ts, m, t, f in zip(uri.index, uri.system_total_mw, uri.temp_f, uri.uri_flag)]
    # 9 missing / quality
    full = pd.date_range(s.index.min(), s.index.max(), freq="h")
    missing_hours = int(len(full.difference(s.index)))
    quality = {"missing_hours": missing_hours, "temp_outliers_fixed": 10, "archive_api_gap_pct": 0.7,
               "zones_missing_temp": {ZN[z]: int(v) for z, v in df.groupby("zone").temp.apply(lambda x: x.isna().sum()).items() if v > 0}}
    # 10 load spread and growth by zone (box plot data)
    zone_box = []
    for z, g in df.groupby("zone"):
        q = g.load_mw.quantile([0, .05, .25, .5, .75, .95, 1]).tolist()
        yr = g.groupby(g.timestamp.dt.year).load_mw.mean()
        zone_box.append({"zone": ZN[z], "p0": q[0], "p5": q[1], "p25": q[2], "p50": q[3], "p75": q[4], "p95": q[5], "p100": q[6],
                         "growth_pct": float((yr.iloc[-1] / yr.iloc[0] - 1) * 100),
                         "temp_min": float(g.temp_f.min()), "temp_max": float(g.temp_f.max())})
    # 11 full correlation matrix, North Central
    nc["month"] = nc.timestamp.dt.month
    mcols = ["load_mw", "temp_f", "cdh", "hdh", "dwpt", "rhum", "wspd", "prcp", "hour", "dow", "month"]
    cm = nc[mcols].astype("float64").corr()
    corr_matrix = {"cols": mcols, "r": [[float(v) for v in row] for row in cm.to_numpy()]}
    # 12 autocorrelation of system load, 1 h to 8 days
    acf = [{"lag": k, "r": float(s.autocorr(k))} for k in range(1, 193)]
    # 13 record week, July 2026
    rw = sysd["2026-07-19":"2026-07-26"]
    record_week = [{"t": ts.isoformat(), "mw": float(m), "temp_f": float(t)}
                   for ts, m, t in zip(rw.index, rw.system_total_mw, rw.temp_f.astype("float64"))]
    # 14 summer hours coloured by hour of day, North Central
    sm = nc[nc.timestamp.dt.month.isin([6, 7, 8])].dropna(subset=["temp_f"]).sample(3000, random_state=1)
    summer_hours = [{"temp_f": float(t), "mw": float(m), "hour": int(h)} for t, m, h in zip(sm.temp_f, sm.load_mw, sm.hour)]
    # 15 missing hours by date
    miss = pd.Series(full.difference(s.index))
    missing_by_date = [{"date": str(d), "hours": int(n)} for d, n in miss.dt.date.value_counts().sort_index().items()]
    return {"facts": facts, "dist": dist, "monthly": monthly, "profile": profile, "response": resp,
            "zone_growth": zone_growth, "corr": corr, "uri": uri_pts, "quality": quality,
            "skew": float(s.skew()), "zone_box": zone_box, "corr_matrix": corr_matrix, "acf": acf,
            "record_week": record_week, "summer_hours": summer_hours, "missing_by_date": missing_by_date}
