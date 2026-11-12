"""Project-wide settings. Edit here, not in the scripts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PROCESSED = ROOT / "data" / "processed"
MODEL_TABLE = DATA_PROCESSED / "ercot_model_table.parquet"
FEATURE_TABLE = DATA_PROCESSED / "features.parquet"
PEAK_TABLE = DATA_PROCESSED / "peak_days.parquet"
OUT_MODELS = ROOT / "outputs" / "models"
OUT_REPORTS = ROOT / "outputs" / "reports"
OUT_FIGURES = ROOT / "outputs" / "figures"

ZONES = ["coast", "east", "farWest", "north", "northC", "southC", "southern", "west"]
TARGET = "load_mw"

# chronological split (never shuffle)
TRAIN_END = "2024-12-31 23:00"
VAL_END = "2025-12-31 23:00"

# day-ahead setting: lags must be >= 48 h so they are known when the forecast is issued
LOAD_LAGS_H = [48, 168]
BALANCE_POINT_F = 65.0      # degree-hour base temperature
RANDOM_STATE = 42

for _p in (DATA_PROCESSED, OUT_MODELS, OUT_REPORTS, OUT_FIGURES):
    _p.mkdir(parents=True, exist_ok=True)
