"""Train the model ladder on the feature table and write a leaderboard.

Run:  python -m src.train            # full run (takes a while)
      python -m src.train --quick    # 10% sample, small models, for a smoke test

Split is chronological: train <= 2024, validate 2025, test 2026.
Models: naive (same hour last week) -> decision tree -> random forest / bagging
        -> gradient boosting / XGBoost -> stacking.
"""
import argparse
import json
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.ensemble import (BaggingRegressor, HistGradientBoostingRegressor,
                              RandomForestRegressor)
from sklearn.model_selection import TimeSeriesSplit
from sklearn.tree import DecisionTreeRegressor
from xgboost import XGBRegressor

from src.config import (FEATURE_TABLE, OUT_MODELS, OUT_REPORTS, TARGET,
                        TRAIN_END, VAL_END, RANDOM_STATE)
from src.evaluate import regression_metrics, metrics_by_group, season_of
from src.features import feature_columns


def split(df):
    train = df[df.timestamp <= TRAIN_END]
    val = df[(df.timestamp > TRAIN_END) & (df.timestamp <= VAL_END)]
    test = df[df.timestamp > VAL_END]
    return train, val, test


class TimeStacking(BaseEstimator, RegressorMixin):
    """Two-level stacking with time-ordered out-of-fold predictions.

    sklearn's StackingRegressor refuses TimeSeriesSplit, so this does the same thing by hand:
    level-1 models produce predictions on the later folds of TimeSeriesSplit, the meta-learner
    is trained on those, then the level-1 models are refit on all training data.
    """

    def __init__(self, estimators, final_estimator, n_splits=3):
        self.estimators = estimators
        self.final_estimator = final_estimator
        self.n_splits = n_splits

    def fit(self, X, y):
        X, y = np.asarray(X), np.asarray(y)
        tss = TimeSeriesSplit(n_splits=self.n_splits)
        oof_idx, oof = [], {name: [] for name, _ in self.estimators}
        for tr, te in tss.split(X):
            oof_idx.append(te)
            for name, est in self.estimators:
                oof[name].append(clone(est).fit(X[tr], y[tr]).predict(X[te]))
        idx = np.concatenate(oof_idx)
        Z = np.column_stack([np.concatenate(oof[name]) for name, _ in self.estimators])
        self.final_ = clone(self.final_estimator).fit(Z, y[idx])
        self.fitted_ = [(name, clone(est).fit(X, y)) for name, est in self.estimators]
        return self

    def predict(self, X):
        Z = np.column_stack([est.predict(np.asarray(X)) for _, est in self.fitted_])
        return self.final_.predict(Z)


def model_zoo(quick):
    n = 60 if quick else 300
    rs = RANDOM_STATE
    rf = RandomForestRegressor(n_estimators=n, max_depth=18, min_samples_leaf=5,
                               n_jobs=-1, random_state=rs)
    xgb = XGBRegressor(n_estimators=200 if quick else 1200, learning_rate=0.05, max_depth=8,
                       subsample=0.8, colsample_bytree=0.8, n_jobs=-1, random_state=rs,
                       tree_method="hist")
    zoo = {
        "decision_tree": DecisionTreeRegressor(max_depth=12, min_samples_leaf=20, random_state=rs),
        "bagging": BaggingRegressor(DecisionTreeRegressor(max_depth=14, min_samples_leaf=10),
                                    n_estimators=n // 3, n_jobs=-1, random_state=rs),
        "random_forest": rf,
        "gradient_boosting": HistGradientBoostingRegressor(max_iter=200 if quick else 800,
                                                           learning_rate=0.06, max_depth=10,
                                                           random_state=rs),
        "xgboost": xgb,
    }
    zoo["stacking"] = TimeStacking(
        estimators=[("rf", rf), ("xgb", xgb)],
        final_estimator=HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05,
                                                      random_state=rs))
    return zoo


def main(quick=False):
    df = pd.read_parquet(FEATURE_TABLE)
    if quick:
        df = df.sample(frac=0.10, random_state=RANDOM_STATE).sort_values("timestamp")
    feats = feature_columns(df)
    train, val, test = split(df)
    print(f"train {len(train):,} | val {len(val):,} | test {len(test):,} rows, {len(feats)} features")

    leaderboard, preds = [], test[["timestamp", "zone", "month", TARGET]].copy()

    # naive baseline: same hour last week
    for name, frame in [("val", val), ("test", test)]:
        m = regression_metrics(frame[TARGET], frame["load_lag_168h"])
        leaderboard.append({"model": "naive_last_week", "split": name, **m, "fit_s": 0})
    preds["naive_last_week"] = test["load_lag_168h"].values

    for name, model in model_zoo(quick).items():
        t0 = time.time()
        model.fit(train[feats], train[TARGET])
        fit_s = round(time.time() - t0, 1)
        for sname, frame in [("val", val), ("test", test)]:
            p = model.predict(frame[feats])
            m = regression_metrics(frame[TARGET], p)
            leaderboard.append({"model": name, "split": sname, **m, "fit_s": fit_s})
            if sname == "test":
                preds[name] = p
        joblib.dump(model, OUT_MODELS / f"{name}.joblib")
        print(f"{name:18s} test R2={m['R2']:.4f} MAPE={m['MAPE_pct']:.2f}%  ({fit_s}s)")

    lb = pd.DataFrame(leaderboard).round(4)
    tag = "_quick" if quick else ""
    lb.to_csv(OUT_REPORTS / f"leaderboard{tag}.csv", index=False)
    preds.to_parquet(OUT_REPORTS / f"test_predictions{tag}.parquet", index=False)

    best = lb[lb.split == "val"].sort_values("MAPE_pct").iloc[0]["model"]
    preds["season"] = preds["month"].map(season_of)
    by_zone = metrics_by_group(preds, TARGET, best, "zone")
    by_season = metrics_by_group(preds, TARGET, best, "season")
    by_zone.to_csv(OUT_REPORTS / f"best_by_zone{tag}.csv")
    by_season.to_csv(OUT_REPORTS / f"best_by_season{tag}.csv")
    (OUT_REPORTS / f"best_model{tag}.json").write_text(json.dumps({"best_on_validation": best}))

    print("\nLeaderboard (test split):")
    print(lb[lb.split == "test"].set_index("model")[["R2", "RMSE_MW", "MAE_MW", "MAPE_pct"]].to_string())
    print(f"\nBest on validation: {best}\n\nBy zone:\n{by_zone}\n\nBy season:\n{by_season}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="10% sample, small models")
    main(**vars(ap.parse_args()))
