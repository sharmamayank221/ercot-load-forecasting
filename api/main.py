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
    summer = d[d.timestamp.dt.month.isin([6, 7, 8])].sample(min(4000, len(d)), random_state=1)
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
