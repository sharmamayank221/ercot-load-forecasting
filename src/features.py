"""Build the model-ready feature table from data/processed/ercot_model_table.parquet.

Run:  python -m src.features
Writes data/processed/features.parquet with one row per hour per zone.
"""
import numpy as np
import pandas as pd
import holidays

from src.config import (MODEL_TABLE, FEATURE_TABLE, ZONES, LOAD_LAGS_H,
                        BALANCE_POINT_F)

US_HOLIDAYS = holidays.US(years=range(2017, 2028))


def add_time_features(df):
    ts = df["timestamp"]
    df["hour"] = ts.dt.hour
    df["dow"] = ts.dt.dayofweek
    df["month"] = ts.dt.month
    df["doy"] = ts.dt.dayofyear
    df["is_weekend"] = (df["dow"] >= 5).astype(int)
    df["is_holiday"] = ts.dt.date.map(lambda d: d in US_HOLIDAYS).astype(int)
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
    df["doy_sin"] = np.sin(2 * np.pi * df["doy"] / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * df["doy"] / 365.25)
    first = ts.min()
    df["trend_months"] = ((ts - first).dt.days / 30.44).astype(float)
    return df


def add_weather_features(df):
    t = df["temp_f"]
    df["cdh"] = (t - BALANCE_POINT_F).clip(lower=0)        # cooling degree-hours
    df["hdh"] = (BALANCE_POINT_F - t).clip(lower=0)        # heating degree-hours
    df["temp_f_sq"] = t ** 2
    # slow building response: average temperature over the previous 24 h and 72 h (per zone)
    g = df.groupby("zone")["temp_f"]
    df["temp_mean_24h"] = g.transform(lambda s: s.rolling(24, min_periods=12).mean())
    df["temp_mean_72h"] = g.transform(lambda s: s.rolling(72, min_periods=36).mean())
    return df


def add_load_lags(df):
    g = df.groupby("zone")["load_mw"]
    for h in LOAD_LAGS_H:
        df[f"load_lag_{h}h"] = g.shift(h)
    # 7-day rolling mean, shifted so it ends 48 h before the target hour
    df["load_roll7d"] = g.transform(lambda s: s.shift(48).rolling(168, min_periods=120).mean())
    return df


def feature_columns(df):
    base = ["hour", "dow", "month", "doy", "is_weekend", "is_holiday",
            "hour_sin", "hour_cos", "doy_sin", "doy_cos", "trend_months",
            "temp_f", "dwpt", "rhum", "wspd", "prcp", "cdh", "hdh", "temp_f_sq",
            "temp_mean_24h", "temp_mean_72h", "load_roll7d"]
    base += [f"load_lag_{h}h" for h in LOAD_LAGS_H]
    base += [c for c in df.columns if c.startswith("zone_")]
    return base


def build():
    df = pd.read_parquet(MODEL_TABLE)
    df = df.sort_values(["zone", "timestamp", "DSTFlag"]).reset_index(drop=True)
    # the repeated November hour: keep the first copy so each zone has a clean hourly series
    df = df[~df.duplicated(subset=["zone", "timestamp"], keep="first")].copy()

    df = add_time_features(df)
    df = add_weather_features(df)
    df = add_load_lags(df)
    df = pd.concat([df, pd.get_dummies(df["zone"], prefix="zone", dtype=int)], axis=1)

    n0 = len(df)
    df = df[~df["uri_flag"]]                              # Winter Storm Uri load shed
    df = df.dropna(subset=feature_columns(df) + ["load_mw"])
    print(f"rows: {n0} -> {len(df)} after dropping Uri window and rows with missing features")

    df.to_parquet(FEATURE_TABLE, index=False)
    print(f"wrote {FEATURE_TABLE}  ({len(feature_columns(df))} features)")
    return df


if __name__ == "__main__":
    build()
