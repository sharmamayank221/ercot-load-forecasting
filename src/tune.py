"""Randomized hyperparameter search for the two fastest strong models (HistGradientBoosting,
XGBoost) using the chronological validation year, plus a peak-hour weighting experiment.

Run:  python -m src.tune --n-iter 8
Writes outputs/reports/tuning.csv and saves the best model as outputs/models/best_tuned.joblib
"""
import argparse
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from xgboost import XGBRegressor

from src.config import FEATURE_TABLE, OUT_MODELS, OUT_REPORTS, TARGET, RANDOM_STATE
from src.evaluate import regression_metrics, metrics_by_group
from src.features import feature_columns
from src.train import split

BASE = "load_roll7d"


def peak_weights(frame, w=3.0):
    """Extra weight on summer afternoons (Jun–Sep, 14:00–19:00), the hours that matter most."""
    hot = frame["month"].between(6, 9) & frame["hour"].between(14, 19)
    return np.where(hot, w, 1.0)


def sample_space(rng, n):
    for _ in range(n):
        yield "hgb", dict(max_iter=int(rng.choice([600, 1000, 1500])),
                          learning_rate=float(rng.choice([0.03, 0.05, 0.08])),
                          max_depth=int(rng.choice([8, 10, 12, None])),
                          max_leaf_nodes=int(rng.choice([31, 63, 127])),
                          min_samples_leaf=int(rng.choice([20, 50, 100])),
                          l2_regularization=float(rng.choice([0.0, 0.5, 2.0])))
        yield "xgb", dict(n_estimators=int(rng.choice([600, 1000, 1500])),
                          learning_rate=float(rng.choice([0.03, 0.05, 0.08])),
                          max_depth=int(rng.choice([6, 8, 10])),
                          subsample=float(rng.choice([0.7, 0.85, 1.0])),
                          colsample_bytree=float(rng.choice([0.7, 0.85, 1.0])),
                          min_child_weight=int(rng.choice([1, 5, 20])))


def make(kind, params):
    if kind == "hgb":
        return HistGradientBoostingRegressor(random_state=RANDOM_STATE, **params)
    return XGBRegressor(tree_method="hist", n_jobs=-1, random_state=RANDOM_STATE, **params)


def main(n_iter=8):
    df = pd.read_parquet(FEATURE_TABLE)
    feats = feature_columns(df)
    train, val, test = split(df)
    y_tr = train[TARGET] / train[BASE]
    rng = np.random.default_rng(RANDOM_STATE)
    rows, best = [], None

    configs = list(sample_space(rng, n_iter))
    # also the two defaults from train.py, with and without peak weights
    configs = [("hgb", dict(max_iter=800, learning_rate=0.06, max_depth=10)),
               ("xgb", dict(n_estimators=240, learning_rate=0.05, max_depth=8,
                            subsample=0.8, colsample_bytree=0.8))] + configs
    for i, (kind, params) in enumerate(configs):
        for weighted in (False, True):
            t0 = time.time()
            m = make(kind, params)
            m.fit(train[feats], y_tr, sample_weight=peak_weights(train) if weighted else None)
            res = {}
            for sname, frame in (("val", val), ("test", test)):
                p = m.predict(frame[feats]) * frame[BASE].values
                for k, v in regression_metrics(frame[TARGET], p).items():
                    res[f"{sname}_{k}"] = v
                if sname == "test":
                    hot = frame["month"].between(6, 9) & frame["hour"].between(14, 19)
                    res["test_peak_MAPE_pct"] = regression_metrics(frame[TARGET][hot], p[hot])["MAPE_pct"]
            row = {"id": i, "model": kind, "peak_weighted": weighted, "fit_s": round(time.time() - t0, 1),
                   **{k: round(v, 4) for k, v in res.items()}, "params": str(params)}
            rows.append(row)
            print(f"{i:2d} {kind} w={int(weighted)} val MAPE {res['val_MAPE_pct']:.2f} "
                  f"test MAPE {res['test_MAPE_pct']:.2f} peak-hours {res['test_peak_MAPE_pct']:.2f} "
                  f"({row['fit_s']}s)", flush=True)
            if best is None or res["val_MAPE_pct"] < best[0]:
                best = (res["val_MAPE_pct"], m, row)
            pd.DataFrame(rows).to_csv(OUT_REPORTS / "tuning.csv", index=False)

    joblib.dump(best[1], OUT_MODELS / "best_tuned.joblib")
    print("\nbest on validation:", best[2]["model"], best[2]["params"], "peak_weighted =", best[2]["peak_weighted"])
    print("its test metrics:", {k: v for k, v in best[2].items() if k.startswith("test_")})


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--n-iter", type=int, default=8)
    main(**vars(ap.parse_args()))
