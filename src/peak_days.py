"""Build the high-peak-day label and train the peak-day classifier.

Label: a day is high-peak (1) when its system-wide peak hour exceeds the 90th percentile
of daily peaks for the same calendar month over the previous two years. The cutoff
rolls forward each year so demand growth does not inflate the label.

Run:  python -m src.peak_days
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, f1_score, recall_score, precision_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from src.config import (MODEL_TABLE, PEAK_TABLE, OUT_REPORTS, ZONES, TRAIN_END, VAL_END,
                        RANDOM_STATE)

PCT = 0.90
LOOKBACK_YEARS = 2


def daily_table():
    df = pd.read_parquet(MODEL_TABLE)
    df = df[~df.uri_flag]
    df["day"] = df.timestamp.dt.normalize()
    sysload = df[df.zone == "northC"].groupby("day")["system_total_mw"].max().rename("peak_mw")
    tmax = df.pivot_table(index="day", columns="zone", values="temp_f", aggfunc="max")
    tmax.columns = [f"tmax_{z}" for z in tmax.columns]
    d = pd.concat([sysload, tmax], axis=1).reset_index()
    d["month"], d["year"], d["dow"] = d.day.dt.month, d.day.dt.year, d.day.dt.dayofweek
    return d


def add_rolling_label(d):
    cut = {}
    for (y, m), _ in d.groupby(["year", "month"]):
        hist = d[(d.month == m) & (d.year >= y - LOOKBACK_YEARS) & (d.year < y)]
        cut[(y, m)] = hist.peak_mw.quantile(PCT) if len(hist) >= 30 else np.nan
    d["cutoff_mw"] = [cut[(y, m)] for y, m in zip(d.year, d.month)]
    d = d.dropna(subset=["cutoff_mw"]).copy()
    d["high_peak"] = (d.peak_mw > d.cutoff_mw).astype(int)
    return d


def add_features(d):
    # everything known the day before: today's peak, yesterday's, last week's, tomorrow's weather
    d = d.sort_values("day").reset_index(drop=True)
    d["y_next"] = d.high_peak.shift(-1)              # label for TOMORROW
    d["peak_today"] = d.peak_mw
    d["peak_lag1"] = d.peak_mw.shift(1)
    d["peak_lag7"] = d.peak_mw.shift(7)
    d["peak_roll7"] = d.peak_mw.rolling(7).mean()
    d["cutoff_next"] = d.cutoff_mw.shift(-1)
    d["gap_to_cutoff"] = d.peak_today / d.cutoff_next
    for z in ZONES:
        d[f"tmax_next_{z}"] = d[f"tmax_{z}"].shift(-1)  # tomorrow's forecast high (observed here)
    d["dow_next"] = (d.dow + 1) % 7
    d["month_next"] = d.day.shift(-1).dt.month
    return d.dropna(subset=["y_next", "peak_lag7", "cutoff_next"])


def main():
    d = add_features(add_rolling_label(daily_table()))
    d.to_parquet(PEAK_TABLE, index=False)
    feats = (["peak_today", "peak_lag1", "peak_lag7", "peak_roll7", "cutoff_next",
              "gap_to_cutoff", "dow_next", "month_next"] + [f"tmax_next_{z}" for z in ZONES])
    train = d[d.day <= TRAIN_END]
    test = d[d.day > TRAIN_END]              # 2025 + 2026
    print(f"days: train {len(train)} (positives {train.y_next.mean():.1%}), "
          f"test {len(test)} (positives {test.y_next.mean():.1%})")

    models = {
        "logistic": make_pipeline(StandardScaler(),
                                  LogisticRegression(class_weight="balanced", max_iter=2000)),
        "random_forest": RandomForestClassifier(n_estimators=400, min_samples_leaf=3,
                                                class_weight="balanced", n_jobs=-1,
                                                random_state=RANDOM_STATE),
        "xgboost": XGBClassifier(n_estimators=400, learning_rate=0.05, max_depth=4,
                                 subsample=0.9, colsample_bytree=0.9,
                                 scale_pos_weight=(1 - train.y_next.mean()) / train.y_next.mean(),
                                 n_jobs=-1, random_state=RANDOM_STATE),
    }
    rows = []
    for name, m in models.items():
        m.fit(train[feats], train.y_next)
        prob = m.predict_proba(test[feats])[:, 1]
        pred = (prob >= 0.5).astype(int)
        rows.append({"model": name,
                     "recall": recall_score(test.y_next, pred),
                     "precision": precision_score(test.y_next, pred, zero_division=0),
                     "F1": f1_score(test.y_next, pred),
                     "PR_AUC": average_precision_score(test.y_next, prob)})
    # seasonal-naive baseline: same calendar day last year was high-peak
    last_year = d.set_index("day").high_peak
    naive = test.day.map(lambda t: last_year.get(t - pd.DateOffset(years=1), 0)).shift(-1).fillna(0)
    rows.append({"model": "seasonal_naive", "recall": recall_score(test.y_next, naive),
                 "precision": precision_score(test.y_next, naive, zero_division=0),
                 "F1": f1_score(test.y_next, naive), "PR_AUC": float("nan")})
    lb = pd.DataFrame(rows).round(3)
    lb.to_csv(OUT_REPORTS / "peak_day_leaderboard.csv", index=False)
    print(lb.to_string(index=False))


if __name__ == "__main__":
    main()
