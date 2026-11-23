"""Project-wide settings. Edit here, not in the scripts."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PROCESSED = ROOT / "data" / "processed"
BASE_MODEL_TABLE = DATA_PROCESSED / "ercot_model_table.parquet"
# the daily refresh writes base + live observed rows here and points everything at it via this variable
MODEL_TABLE = Path(os.environ.get("ERCOT_MODEL_TABLE", BASE_MODEL_TABLE))
LIVE_DIR = ROOT / "data" / "live"
LIVE_MODEL_TABLE = DATA_PROCESSED / "ercot_model_table_live.parquet"
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
