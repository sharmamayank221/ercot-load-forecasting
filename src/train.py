"""Train the model ladder on the feature table and write a leaderboard.

Run:  python -m src.train            # full run (takes a while)
      python -m src.train --quick    # 10% sample, small models, for a smoke test
      python -m src.train --trees 80 # full data, lighter ensembles (single-core laptop)
      python -m src.train --ratio-target   # growth-robust target (recommended, see main())

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
from sklearn.linear_model import RidgeCV
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


def model_zoo(quick, trees=300):
    n = 60 if quick else trees
    rs = RANDOM_STATE
    rf = RandomForestRegressor(n_estimators=n, max_depth=18, min_samples_leaf=5,
                               n_jobs=-1, random_state=rs)
    xgb = XGBRegressor(n_estimators=200 if quick else max(400, trees * 3), learning_rate=0.05, max_depth=8,
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
    # meta-learner is linear: a tree meta-learner cannot extrapolate past the out-of-fold
    # prediction range, which matters when demand keeps growing (v1 stacking got 13.8% MAPE)
    rf_small = RandomForestRegressor(n_estimators=max(20, n // 2), max_depth=16, min_samples_leaf=5,
                                     n_jobs=-1, random_state=rs)   # keeps stacking affordable
    zoo["stacking"] = TimeStacking(
        estimators=[("rf", rf_small), ("xgb", xgb), ("gb", zoo["gradient_boosting"])],
        final_estimator=RidgeCV(alphas=(0.1, 1.0, 10.0)))
    return zoo


def main(quick=False, trees=300, ratio_target=False, models=None):
    """ratio_target: fit y / load_roll7d instead of y, then multiply back.

    Trees cannot predict values above anything seen in training, so with demand growing
    every year they under-predict the newest data (Far West got a negative R2). Predicting
    the ratio to recent load lets the trend come from the data itself.
    """
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

    base_col = "load_roll7d"
    y_train = train[TARGET] / train[base_col] if ratio_target else train[TARGET]
    tag = ("_quick" if quick else "") + ("_ratio" if ratio_target else "")
    zoo = model_zoo(quick, trees)
    if models:                      # retrain only some models, keep the rest of the leaderboard
        zoo = {k: v for k, v in zoo.items() if k in models}
        old_lb = pd.read_csv(OUT_REPORTS / f"leaderboard{tag}.csv")
        leaderboard = old_lb[~old_lb.model.isin(list(zoo))].to_dict("records")
        old_preds = pd.read_parquet(OUT_REPORTS / f"test_predictions{tag}.parquet")
        for c in old_preds.columns:
            if c not in preds.columns and c not in zoo:
                preds[c] = old_preds[c].values
    for name, model in zoo.items():
        t0 = time.time()
        model.fit(train[feats], y_train)
        fit_s = round(time.time() - t0, 1)
        for sname, frame in [("val", val), ("test", test)]:
            p = model.predict(frame[feats])
            if ratio_target:
                p = p * frame[base_col].values
            m = regression_metrics(frame[TARGET], p)
            leaderboard.append({"model": name, "split": sname, **m, "fit_s": fit_s})
            if sname == "test":
                preds[name] = p
        joblib.dump(model, OUT_MODELS / f"{name}.joblib")
        print(f"{name:18s} test R2={m['R2']:.4f} MAPE={m['MAPE_pct']:.2f}%  ({fit_s}s)")

    lb = pd.DataFrame(leaderboard).round(4)
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
    ap.add_argument("--ratio-target", action="store_true",
                    help="predict load / 7-day rolling load, then rescale (handles demand growth)")
    ap.add_argument("--models", nargs="*", help="retrain only these models (e.g. --models stacking)")
    ap.add_argument("--trees", type=int, default=300,
                    help="forest size for the full run (XGBoost rounds = 3x this); lower on slow machines")
    main(**vars(ap.parse_args()))
