"""Daily live refresh: pull the latest observed load and weather, forecast tomorrow, rebuild the model inputs.

    python -m src.live.refresh                       # live: ERCOT API + Meteostat + Open-Meteo
    python -m src.live.refresh --simulate 2026-11-02 # offline test: pretend today is that date, use local data

Writes
  data/live/load_live.parquet, data/live/weather_live.parquet   observed rows after the base table (small; committed)
  data/processed/ercot_model_table_live.parquet                  base + live observations (point ERCOT_MODEL_TABLE here)
  data/processed/features.parquet                                features, including tomorrow's rows (load unknown)

Then run `python -m src.peak_days` and `python scripts/export_static.py` with ERCOT_MODEL_TABLE set
(the GitHub Actions workflow does all of this).

Needs ERCOT_USER / ERCOT_PASS / ERCOT_KEY for the live ERCOT pull. Open-Meteo and Meteostat need no key.
"""
import argparse
import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from src.config import BASE_MODEL_TABLE, FEATURE_TABLE, LIVE_DIR, LIVE_MODEL_TABLE
from src.features import add_load_lags, add_time_features, add_weather_features, feature_columns

CT = ZoneInfo("America/Chicago")
ZONES = ["coast", "east", "farWest", "north", "northC", "southC", "southern", "west"]
# the airports used in training (Meteostat ids) and their coordinates (for the Open-Meteo forecast)
STATIONS = {"coast": ("72243", 29.98, -95.34), "east": ("KTYR0", 32.35, -95.40), "farWest": ("72265", 31.94, -102.19),
            "north": ("72351", 33.98, -98.49), "northC": ("72259", 32.90, -97.04), "southC": ("74745", 30.19, -97.67),
            "southern": ("72251", 27.77, -97.50), "west": ("72266", 32.41, -99.68)}
WVARS = ["temp", "dwpt", "rhum", "wspd", "prcp"]
LOAD_LIVE, WEATHER_LIVE = LIVE_DIR / "load_live.parquet", LIVE_DIR / "weather_live.parquet"


# ------------------------------------------------------------------ sources
def pull_load(start, end):
    """ERCOT actual load by weather zone, long format: timestamp, DSTFlag, zone, load_mw, system_total_mw."""
    from src.data_pipeline.ercot_load_pull import Session, add_timestamp, fetch_range
    raw = fetch_range(Session(), pd.Timestamp(start), pd.Timestamp(end))
    if raw.empty:
        return pd.DataFrame()
    w = add_timestamp(raw)
    w = w.drop_duplicates(["timestamp", "DSTFlag"])
    long = w.melt(id_vars=["timestamp", "DSTFlag", "total"], value_vars=ZONES, var_name="zone", value_name="load_mw")
    return long.rename(columns={"total": "system_total_mw"}).astype({"load_mw": float, "system_total_mw": float})


def pull_weather_obs(start, end):
    """Observed hourly weather at the training stations (Meteostat, UTC -> ERCOT local hours)."""
    from meteostat import Hourly
    from src.data_pipeline.ercot_weather_pull import to_ercot_hours
    out = []
    for z, (sid, _, _) in STATIONS.items():
        # model=False: real observations only (by default Meteostat fills unobserved hours with model estimates)
        raw = Hourly(sid, pd.Timestamp(start).to_pydatetime() - timedelta(days=1), pd.Timestamp(end).to_pydatetime() + timedelta(days=1), model=False).fetch()
        if raw.empty:
            continue
        raw = raw[[v for v in WVARS if v in raw.columns]]
        raw = raw.reindex(pd.date_range(raw.index.min(), raw.index.max(), freq="h"))
        raw[[c for c in raw.columns if c != "prcp"]] = raw[[c for c in raw.columns if c != "prcp"]].interpolate(limit=3, limit_direction="both")
        if "prcp" in raw:
            raw["prcp"] = raw["prcp"].fillna(0)          # as in training: no rain report = no rain
        w = to_ercot_hours(raw)
        w["zone"] = z
        out.append(w[(w.timestamp >= pd.Timestamp(start)) & (w.timestamp < pd.Timestamp(end) + pd.Timedelta(days=1))])
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def pull_weather_forecast():
    """Open-Meteo hourly forecast for today and tomorrow, local Texas time, same units as training."""
    out = []
    for z, (_, lat, lon) in STATIONS.items():
        q = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "timezone": "America/Chicago", "forecast_days": 2,
                                    "hourly": "temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,precipitation"})
        with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{q}", timeout=60) as r:
            h = json.load(r)["hourly"]
        df = pd.DataFrame({"timestamp": pd.to_datetime(h["time"]), "temp": h["temperature_2m"], "dwpt": h["dew_point_2m"],
                           "rhum": h["relative_humidity_2m"], "wspd": h["wind_speed_10m"], "prcp": h["precipitation"]})
        df["zone"], df["DSTFlag"] = z, df.timestamp.duplicated()
        out.append(df)
    return pd.concat(out, ignore_index=True)


def merge_weather(obs, fc):
    """Observed weather where it is complete, forecast weather for every missing value or hour.

    Hour by hour and variable by variable, rather than switching to the forecast at one cut-off time,
    so a station gap or a missing variable never blanks out a forecast hour.
    """
    keys = ["zone", "timestamp", "DSTFlag"]
    o = obs.drop_duplicates(keys, keep="last").set_index(keys)[WVARS].astype("float64")
    f = fc.drop_duplicates(keys, keep="first").set_index(keys)[WVARS].astype("float64")
    w = o.combine_first(f).reset_index().sort_values(["zone", "timestamp", "DSTFlag"])
    w["prcp"] = w["prcp"].fillna(0)
    others = [c for c in WVARS if c != "prcp"]
    w[others] = w.groupby("zone")[others].transform(lambda c: c.interpolate(limit=3, limit_direction="both"))
    return w


# ------------------------------------------------------------------ simulation (offline test with local data)
def simulated_sources(base, today):
    """Pretend `today` is today: observations end at today 17:00, the 'forecast' is the observed weather."""
    now = pd.Timestamp(today) + pd.Timedelta(hours=17)
    obs = base[base.timestamp <= now]
    load = obs[["timestamp", "DSTFlag", "zone", "load_mw", "system_total_mw"]]
    weather = obs[["timestamp", "DSTFlag", "zone"] + WVARS]
    fc = base[(base.timestamp > now) & (base.timestamp < pd.Timestamp(today) + pd.Timedelta(days=2))][["timestamp", "DSTFlag", "zone"] + WVARS]
    return load, weather, fc


# ------------------------------------------------------------------ main
def main(simulate=None):
    base = pd.read_parquet(BASE_MODEL_TABLE)
    today = pd.Timestamp(simulate) if simulate else pd.Timestamp(datetime.now(CT).date())
    tomorrow = today + pd.Timedelta(days=1)

    if simulate:   # cut the base back so there is something to "pull"
        load_src, weather_src, fc = simulated_sources(base, today)
        base = base[base.timestamp < today - pd.Timedelta(days=3)]
        last = base.timestamp.max()
        new_load = load_src[load_src.timestamp > last]
        new_weather = weather_src[weather_src.timestamp > last]
        live_load, live_weather = new_load, new_weather
    else:
        live_load = pd.read_parquet(LOAD_LIVE) if LOAD_LIVE.exists() else pd.DataFrame()
        live_weather = pd.read_parquet(WEATHER_LIVE) if WEATHER_LIVE.exists() else pd.DataFrame()
        last = max([base.timestamp.max()] + ([live_load.timestamp.max()] if len(live_load) else []))
        start = (last - pd.Timedelta(days=1)).normalize()        # re-pull a day of overlap: late corrections win
        print(f"pulling observations {start.date()} -> {today.date()}")
        new_load = pull_load(start, today)
        new_weather = pull_weather_obs(start, today)
        fc = pull_weather_forecast()
        live_load = pd.concat([live_load, new_load]).drop_duplicates(["timestamp", "DSTFlag", "zone"], keep="last")
        live_weather = pd.concat([live_weather, new_weather]).drop_duplicates(["timestamp", "DSTFlag", "zone"], keep="last")
        LIVE_DIR.mkdir(parents=True, exist_ok=True)
        live_load.to_parquet(LOAD_LIVE, index=False)
        live_weather.to_parquet(WEATHER_LIVE, index=False)
    print(f"live rows: load {len(live_load)}, weather {len(live_weather)}")

    # observed table: base + live load joined to live weather (only hours with observed load)
    obs = live_load.merge(live_weather, on=["timestamp", "DSTFlag", "zone"], how="left")
    obs = obs[obs.timestamp > base.timestamp.max()]
    obs["source"], obs["uri_flag"] = "live", False
    obs["temp_f"] = obs["temp"].astype("float64") * 9 / 5 + 32
    observed = pd.concat([base, obs[base.columns]], ignore_index=True).sort_values(["zone", "timestamp", "DSTFlag"])
    observed.to_parquet(LIVE_MODEL_TABLE, index=False)
    last_obs = observed.timestamp.max()

    # weather for every hour through the end of tomorrow: observed where we have it, forecast after
    wx_obs = pd.concat([base[["timestamp", "DSTFlag", "zone"] + WVARS], live_weather[["timestamp", "DSTFlag", "zone"] + WVARS]])
    if not simulate:   # never trust "observations" from the future
        wx_obs = wx_obs[wx_obs.timestamp <= pd.Timestamp(datetime.now(CT).replace(tzinfo=None))]
    weather = merge_weather(wx_obs, fc)

    # one row per zone-hour, contiguous to the end of tomorrow, so the 48 h / 168 h lags line up
    grid = pd.MultiIndex.from_product([ZONES, pd.date_range(observed.timestamp.min(), tomorrow + pd.Timedelta(hours=23), freq="h")],
                                      names=["zone", "timestamp"]).to_frame(index=False)
    load_cols = observed[~observed.DSTFlag][["zone", "timestamp", "load_mw", "system_total_mw", "uri_flag", "source"]]
    df = grid.merge(load_cols, on=["zone", "timestamp"], how="left").merge(
        weather[~weather.DSTFlag].drop(columns="DSTFlag"), on=["zone", "timestamp"], how="left")
    for c in WVARS:
        df[c] = df[c].astype("float64")
    df["temp_f"] = df["temp"] * 9 / 5 + 32
    df["uri_flag"] = df["uri_flag"].fillna(False).astype(bool)
    df["DSTFlag"] = False
    df = df.sort_values(["zone", "timestamp"]).reset_index(drop=True)

    df = add_load_lags(add_weather_features(add_time_features(df)))
    df = pd.concat([df, pd.get_dummies(df["zone"], prefix="zone", dtype=int)], axis=1)
    feats = feature_columns(df)
    future = df.timestamp > last_obs
    keep = ~df.uri_flag & df[feats].notna().all(axis=1) & (df.load_mw.notna() | future)
    out = df[keep]
    out.to_parquet(FEATURE_TABLE, index=False)

    t = out[out.timestamp.dt.normalize() == tomorrow]
    print(f"observed through {last_obs} | tomorrow {tomorrow.date()}: {t.zone.nunique()} zones, {len(t)} hourly rows ready to forecast")
    if simulate and len(t):   # score the simulated forecast against what really happened
        from src.agent.tools import _model
        model, name = _model()
        pred = model.predict(t[feats]) * t["load_roll7d"].to_numpy()
        b = pd.read_parquet(BASE_MODEL_TABLE)
        actual = b[~b.DSTFlag].drop_duplicates(["zone", "timestamp"]).set_index(["zone", "timestamp"]).load_mw
        a = actual.reindex(list(zip(t.zone, t.timestamp))).to_numpy()
        ok = ~np.isnan(a)
        print(f"simulated day-ahead MAPE for {tomorrow.date()} ({name}): {np.mean(np.abs(pred[ok] - a[ok]) / a[ok]) * 100:.2f}% over {ok.sum()} hours")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--simulate", help="offline test: treat this date as today and use local data")
    main(ap.parse_args().simulate)
