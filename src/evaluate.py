"""Metrics and reporting helpers shared by the training scripts."""
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def regression_metrics(y_true, y_pred):
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    return {
        "R2": r2_score(y_true, y_pred),
        "RMSE_MW": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "MAE_MW": mean_absolute_error(y_true, y_pred),
        "MAPE_pct": float(np.mean(np.abs((y_true - y_pred) / y_true)) * 100),
    }


def metrics_by_group(df, y_col, pred_col, group_col):
    rows = []
    for key, g in df.groupby(group_col):
        m = regression_metrics(g[y_col], g[pred_col])
        m[group_col] = key
        rows.append(m)
    return pd.DataFrame(rows).set_index(group_col).round(3)


def season_of(month):
    return {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer", 9: "fall", 10: "fall", 11: "fall"}[month]
