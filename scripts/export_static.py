"""Precompute everything the web app shows into JSON under web/public/data/.

After this, the Next.js app needs no Python backend and deploys to Vercel as-is.
Run from the project root after `make train && make peak`:

    python scripts/export_static.py                   # forecasts from 2025-01-01 (val + test)
    python scripts/export_static.py --start 2024-01-01

Writes (all small, integer-rounded JSON):
  summary.json  eda.json  peaks.json  meta.json
  profile/<zone>.json   load/<zone>.json   forecast/<zone>.json   whatif/<zone>.json
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.config import FEATURE_TABLE                       # noqa: E402
from src.features import feature_columns                   # noqa: E402
from src.agent import tools as T                           # noqa: E402
import api.main as A                                       # noqa: E402

OUT = ROOT / "web" / "public" / "data"
SHIFTS = list(range(-15, 16, 3))           # what-if temperature shifts, °F
BASE = "load_roll7d"


def clean(o):
    """Make values JSON-safe: NaN -> None, numpy -> python."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if math.isnan(o) or math.isinf(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if o is pd.NA or o is pd.NaT:
        return None
    return o


def write(rel, obj):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(clean(obj), separators=(",", ":")))
    return p.stat().st_size


def shifted(X, s):
    X = X.copy()
    if s:
        X["temp_f"] = X["temp_f"] + s
        X["cdh"] = (X["temp_f"] - 65).clip(lower=0)
        X["hdh"] = (65 - X["temp_f"]).clip(lower=0)
        X["temp_f_sq"] = X["temp_f"] ** 2
        X["temp_mean_24h"] = X["temp_mean_24h"] + s
        X["temp_mean_72h"] = X["temp_mean_72h"] + s
    return X


def main(start):
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = {}
    print("summary, eda, peaks ...")
    sizes["summary"] = write("summary.json", A.summary())
    sizes["eda"] = write("eda.json", A.eda())
    sizes["peaks"] = write("peaks.json", A.peaks())

    model, model_name = T._model()
    feats_df = pd.read_parquet(FEATURE_TABLE)
    feats = feature_columns(feats_df)
    imp = T.explain("North Central", str(feats_df.timestamp.max().date()))
    table = A.table()

    for key, name in T.ZONE_NAMES.items():
        print(f"{name}: profile, load, forecasts ...")
        sizes[f"profile/{key}"] = write(f"profile/{key}.json", A.profile(name))

        z = table[table.zone == key].sort_values("timestamp")
        sizes[f"load/{key}"] = write(f"load/{key}.json", {
            "zone": name,
            "t": ((z.timestamp - pd.Timestamp("1970-01-01")) // pd.Timedelta(hours=1)).astype(int).tolist(),  # hours since 1970 (wall clock)
            "mw": z.load_mw.round().astype(int).tolist(),
            "temp": z.temp_f.astype("float64").round(1).tolist()})

        d = feats_df[(feats_df.zone == key) & (feats_df.timestamp >= start)].sort_values("timestamp")
        X = d[feats]
        base = d[BASE].to_numpy()
        preds = {s: model.predict(shifted(X, s)) * base for s in SHIFTS}
        d = d.assign(day=d.timestamp.dt.date.astype(str), hour=d.timestamp.dt.hour)

        fc, wi = {}, {}
        for day, g in d.groupby("day", sort=True):
            idx = d.index.get_indexer(g.index)
            f0 = preds[0][idx]
            act = g.load_mw.to_numpy()
            i = int(f0.argmax())
            fc[day] = {
                "hour": g.hour.tolist(),
                "forecast": np.round(f0).astype(int).tolist(),
                "actual": np.round(act).astype(int).tolist(),
                "naive": np.round(g.load_lag_168h.to_numpy()).astype(int).tolist(),
                "temp": g.temp_f.astype("float64").round(1).tolist(),
                "peak_mw": int(round(f0.max())), "peak_hour": int(g.hour.iloc[i]), "mean_mw": int(round(f0.mean())),
                "actual_peak_mw": int(round(act.max())),
                "mape_pct": round(float(np.mean(np.abs(f0 - act) / act) * 100), 2),
                "weather": {"temp_high_f": round(float(g.temp_f.max()), 1), "temp_low_f": round(float(g.temp_f.min()), 1),
                            "humidity_mean_pct": int(round(g.rhum.mean()))},
                "inputs": {"temp_high_f": round(float(g.temp_f.max()), 1),
                           "load_same_hour_last_week_peak_mw": int(round(g.load_lag_168h.max())),
                           "rolling_7day_mean_mw": int(round(g[BASE].mean())),
                           "weekend": bool(g.is_weekend.iloc[0]), "holiday": bool(g.is_holiday.iloc[0])}}
            wi[day] = [np.round(preds[s][idx]).astype(int).tolist() for s in SHIFTS]
        sizes[f"forecast/{key}"] = write(f"forecast/{key}.json", fc)
        sizes[f"whatif/{key}"] = write(f"whatif/{key}.json", wi)

    # daily.json: one row per day, system and zone peaks, for top_days / compare_zones tools
    tb = table.assign(day=table.timestamp.dt.date.astype(str))
    sysd = tb[tb.zone == "northC"].groupby("day").agg(system_peak=("system_total_mw", "max"), tmax_dfw=("temp_f", "max"))
    zp = tb.pivot_table(index="day", columns="zone", values="load_mw", aggfunc=["max", "mean"])
    alldays = sysd.index.tolist()
    sizes["daily"] = write("daily.json", {
        "days": alldays,
        "system_peak": sysd.system_peak.round().astype(int).tolist(),
        "tmax_dfw": sysd.tmax_dfw.astype("float64").round(1).tolist(),
        "zones": {k: {"peak": zp["max"][k].reindex(alldays).round().astype("Int64").tolist(),
                      "mean": zp["mean"][k].reindex(alldays).round().astype("Int64").tolist()} for k in T.ZONE_NAMES}})

    days = sorted(fc)
    lb = A.summary()["leaderboard"]
    sizes["meta"] = write("meta.json", {
        "zones": [{"key": k, "name": n} for k, n in T.ZONE_NAMES.items()],
        "forecast_start": days[0], "forecast_end": days[-1], "shifts": SHIFTS,
        "model": model_name.replace(".joblib", ""), "importance_source": imp.get("importance_source", model_name),
        "top_features": imp["top_features"], "leaderboard": lb,
        "data_start": str(table.timestamp.min().date()), "data_end": str(table.timestamp.max().date())})

    total = sum(sizes.values())
    print(f"\nwrote {len(sizes)} files to {OUT.relative_to(ROOT)}  ({total / 1e6:.1f} MB)")
    print(f"forecasts and what-if: {days[0]} to {days[-1]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-01-01")
    main(ap.parse_args().start)
