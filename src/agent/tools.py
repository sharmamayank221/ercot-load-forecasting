"""Tools the grid-analyst agent can call. Every number the agent reports comes from these.

They are plain Python functions (so they can be unit-tested without an LLM) wrapped with
LangChain's @tool so the agent can call them. Each returns a small dict.
"""
import json
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from src.config import FEATURE_TABLE, MODEL_TABLE, OUT_MODELS, OUT_REPORTS, PEAK_TABLE, ZONES
from src.features import feature_columns

BASE = "load_roll7d"
ZONE_NAMES = {"coast": "Coast", "east": "East", "farWest": "Far West", "north": "North",
              "northC": "North Central", "southC": "South Central", "southern": "Southern",
              "west": "West"}


@lru_cache(maxsize=1)
def _features():
    return pd.read_parquet(FEATURE_TABLE)


@lru_cache(maxsize=1)
def _model():
    for name in ("best_tuned.joblib", "gradient_boosting.joblib", "xgboost.joblib"):
        p = OUT_MODELS / name
        if p.exists():
            return joblib.load(p), name
    raise FileNotFoundError("no trained model in outputs/models; run `make train` first")


def _zone(z):
    z = str(z).strip()
    for key, name in ZONE_NAMES.items():
        if z.lower() in (key.lower(), name.lower()):
            return key
    raise ValueError(f"unknown zone {z!r}; use one of {list(ZONE_NAMES.values())}")


def _day_rows(zone, date):
    df = _features()
    day = pd.Timestamp(date).normalize()
    rows = df[(df.zone == zone) & (df.timestamp.dt.normalize() == day)]
    if rows.empty:
        raise ValueError(f"no data for {ZONE_NAMES[zone]} on {day.date()} "
                         f"(data covers {df.timestamp.min().date()} to {df.timestamp.max().date()})")
    return rows.sort_values("timestamp")


def get_load(zone: str, start: str, end: str) -> dict:
    """Actual hourly load in MW for one ERCOT weather zone between two dates (inclusive)."""
    z = _zone(zone)
    df = pd.read_parquet(MODEL_TABLE, columns=["timestamp", "zone", "load_mw"])
    s = df[(df.zone == z) & (df.timestamp >= pd.Timestamp(start)) &
           (df.timestamp < pd.Timestamp(end) + pd.Timedelta(days=1))]
    if s.empty:
        return {"error": f"no data for {ZONE_NAMES[z]} in that range"}
    peak = s.loc[s.load_mw.idxmax()]
    return {"zone": ZONE_NAMES[z], "hours": len(s), "mean_mw": round(s.load_mw.mean()),
            "min_mw": round(s.load_mw.min()), "max_mw": round(s.load_mw.max()),
            "peak_time": str(peak.timestamp), "daily_peaks_mw":
            {str(k): int(v) for k, v in s.groupby(s.timestamp.dt.date).load_mw.max().items()}}


def get_weather(zone: str, date: str) -> dict:
    """Hourly temperature (°F) and humidity for a zone on one date, as the model saw it."""
    z = _zone(zone)
    r = _day_rows(z, date)
    return {"zone": ZONE_NAMES[z], "date": str(pd.Timestamp(date).date()),
            "temp_high_f": round(r.temp_f.max(), 1), "temp_low_f": round(r.temp_f.min(), 1),
            "hour_of_high": int(r.loc[r.temp_f.idxmax(), "hour"]),
            "humidity_mean_pct": round(r.rhum.mean()), "rain_in_mm": round(r.prcp.sum(), 1)}


def forecast_load(zone: str, date: str, temp_shift_f: float = 0.0) -> dict:
    """Day-ahead hourly load forecast (MW) for a zone and date from the trained model.
    temp_shift_f shifts every hour's temperature by that many °F (what-if scenario)."""
    z = _zone(zone)
    r = _day_rows(z, date).copy()
    model, name = _model()
    if temp_shift_f:
        r["temp_f"] = r["temp_f"] + temp_shift_f
        r["cdh"] = (r["temp_f"] - 65).clip(lower=0)
        r["hdh"] = (65 - r["temp_f"]).clip(lower=0)
        r["temp_f_sq"] = r["temp_f"] ** 2
        r["temp_mean_24h"] = r["temp_mean_24h"] + temp_shift_f
        r["temp_mean_72h"] = r["temp_mean_72h"] + temp_shift_f
    p = model.predict(r[feature_columns(r)]) * r[BASE].values
    out = {"zone": ZONE_NAMES[z], "date": str(pd.Timestamp(date).date()), "model": name,
           "temp_shift_f": temp_shift_f, "peak_mw": round(float(p.max())),
           "peak_hour": int(r.hour.values[int(p.argmax())]), "mean_mw": round(float(p.mean())),
           "hourly_mw": [round(float(v)) for v in p]}
    if "load_mw" in r:                                   # actuals exist for past dates
        out["actual_peak_mw"] = round(float(r.load_mw.max()))
        out["mape_pct"] = round(float(np.mean(np.abs(p - r.load_mw.values) / r.load_mw.values) * 100), 2)
    return out


def what_if(zone: str, date: str, temp_shift_f: float) -> dict:
    """Compare the forecast for a zone and date with and without a temperature shift (°F)."""
    base = forecast_load(zone, date, 0.0)
    alt = forecast_load(zone, date, temp_shift_f)
    return {"zone": base["zone"], "date": base["date"], "temp_shift_f": temp_shift_f,
            "peak_mw_base": base["peak_mw"], "peak_mw_shifted": alt["peak_mw"],
            "peak_change_mw": alt["peak_mw"] - base["peak_mw"],
            "peak_change_pct": round((alt["peak_mw"] / base["peak_mw"] - 1) * 100, 1),
            "mean_change_mw": alt["mean_mw"] - base["mean_mw"]}


def peak_risk(date: str) -> dict:
    """Whether a date is labelled a high-peak day for the ERCOT system and by what margin."""
    d = pd.read_parquet(PEAK_TABLE)
    day = pd.Timestamp(date).normalize()
    r = d[d.day == day]
    if r.empty:
        return {"error": f"no peak-day record for {day.date()}"}
    r = r.iloc[0]
    return {"date": str(day.date()), "system_peak_mw": round(r.peak_mw),
            "cutoff_mw": round(r.cutoff_mw), "high_peak_day": bool(r.high_peak),
            "margin_pct": round((r.peak_mw / r.cutoff_mw - 1) * 100, 1)}


def explain(zone: str, date: str) -> dict:
    """Top drivers of a day's forecast: feature importances of the model, plus the day's key inputs."""
    z = _zone(zone)
    model, name = _model()
    feats = feature_columns(_features())
    imp = getattr(model, "feature_importances_", None)
    source = name
    if imp is None:                                   # HistGradientBoosting has none: borrow XGBoost's
        xp = OUT_MODELS / "xgboost.joblib"
        if xp.exists():
            imp, source = joblib.load(xp).feature_importances_, "xgboost.joblib (importances)"
    top = (sorted(zip(feats, imp), key=lambda t: -t[1])[:8] if imp is not None
           else [("no feature importances available", 0)])
    r = _day_rows(z, date)
    return {"zone": ZONE_NAMES[z], "date": str(pd.Timestamp(date).date()), "model": name,
            "importance_source": source,
            "top_features": [(f, round(float(v), 4)) for f, v in top],
            "inputs": {"temp_high_f": round(r.temp_f.max(), 1),
                       "load_same_hour_last_week_peak_mw": round(r.load_lag_168h.max()),
                       "rolling_7day_mean_mw": round(r[BASE].mean()), "weekend": bool(r.is_weekend.iloc[0]),
                       "holiday": bool(r.is_holiday.iloc[0])}}


def model_card() -> dict:
    """Which model is in use and its test-year accuracy from the leaderboard."""
    _, name = _model()
    lb_path = OUT_REPORTS / "leaderboard_ratio.csv"
    lb = pd.read_csv(lb_path) if lb_path.exists() else pd.DataFrame()
    test = lb[lb.split == "test"].set_index("model") if len(lb) else lb
    return {"model_file": name, "test_year": 2026, "zones": list(ZONE_NAMES.values()),
            "leaderboard_test_mape_pct": test["MAPE_pct"].round(2).to_dict() if len(test) else {}}


PLAIN_TOOLS = [get_load, get_weather, forecast_load, what_if, peak_risk, explain, model_card]
