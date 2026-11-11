"""Quick checks that the feature table respects the day-ahead rules. Run: pytest -q"""
import pandas as pd
from src.config import FEATURE_TABLE, LOAD_LAGS_H
from src.features import feature_columns


def test_lags_are_day_ahead_safe():
    assert min(LOAD_LAGS_H) >= 48


def test_feature_table_has_no_leakage_columns():
    df = pd.read_parquet(FEATURE_TABLE, columns=None)
    feats = feature_columns(df)
    assert "system_total_mw" not in feats and "load_mw" not in feats


def test_no_missing_features():
    df = pd.read_parquet(FEATURE_TABLE)
    assert df[feature_columns(df)].isna().sum().sum() == 0
