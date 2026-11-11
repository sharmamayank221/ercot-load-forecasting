# Texas Grid Demand Forecasting (ERCOT)

Machine Learning 6302 · Fall 2026 · Mayanka Sharma

Day-ahead forecasting of hourly electricity demand for ERCOT's eight weather zones, a
high-peak-day classifier, and (next) a tool-calling grid-analyst agent on top of the models.

## Layout

```
data/processed/   ercot_hourly_load_2018_to_now.parquet  cleaned hourly load, 8 zones + total
                  ercot_model_table.parquet              load joined with zone weather (619,968 rows)
                  features.parquet                       built by src/features.py (not in git)
src/data_pipeline/  scripts that built the data (ERCOT archives + API, Meteostat weather)
src/config.py     paths, split dates, lag settings
src/features.py   feature engineering  -> python -m src.features
src/train.py      model ladder + leaderboard -> python -m src.train [--quick]
src/peak_days.py  high-peak-day label + classifier -> python -m src.peak_days
src/evaluate.py   metrics helpers
notebooks/01_eda.py   EDA cells (VS Code notebook cells)
outputs/reports/  leaderboards and per-zone / per-season metrics
outputs/models/   saved models (not in git)
tests/            leakage and sanity checks (pytest -q)
```

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # only needed to re-pull ERCOT API data
```

## Run

```bash
make quick     # features + 10% sample training, ~1 min, to check everything works
make train     # full model ladder (several minutes)
make peak      # high-peak-day label and classifier
pytest -q      # sanity checks
```

## Method

* **Split:** chronological. Train 2018–2024, validate 2025, test Jan–Nov 2026. Never shuffled.
* **Features (32):** hour/day/month with sine–cosine encoding, weekend and US-holiday flags,
  trend; temperature, dew point, humidity, wind, rain; cooling/heating degree-hours, temp²,
  24 h and 72 h temperature means; load 48 h and 168 h earlier and a 7-day rolling mean
  (lags ≥ 48 h so every value is known when the day-ahead forecast is issued); zone one-hot.
* **Excluded:** Winter Storm Uri window (Feb 14–20, 2021), rows with missing lags.
* **Model ladder:** naive same-hour-last-week → decision tree → bagging / random forest →
  gradient boosting / XGBoost → stacking (RF + XGB → GB meta-learner, time-ordered
  out-of-fold predictions).
* **Peak-day label:** day's system peak above the 90th percentile of daily peaks for the same
  month over the previous two years (rolling, so demand growth does not inflate the label).

## First results (10% sample, `make quick`, test = 2026)

| model | R² | MAE (MW) | MAPE |
| --- | --- | --- | --- |
| naive last week | 0.957 | 670 | 8.9% |
| decision tree | 0.977 | 574 | 7.9% |
| random forest | 0.984 | 479 | 6.7% |
| gradient boosting | **0.989** | **393** | **5.4%** |
| XGBoost | 0.986 | 441 | 6.2% |
| stacking | 0.987 | 414 | 5.9% |

Peak-day classifier (test = 2025–26): random forest recall 0.72 / precision 0.96 / PR-AUC 0.95;
logistic regression recall 0.89 / F1 0.82; seasonal-naive baseline F1 0.34.

Notes from the first run, to investigate:
* Far West zone has a negative test R²: its load is nearly flat within a day but has grown
  fast (oil, gas and data-centre load), so the model under-predicts the 2026 level.
  Candidate fixes: zone-specific trend, or train one model per zone.
* Even with the rolling cutoff, 43% of 2025–26 days are labelled high-peak (26% in training),
  because growth accelerated. A one-year lookback or a trend-adjusted cutoff may be needed.
* Weather features are *observed* weather; real day-ahead forecasts will be noisier.

## Roadmap

1. Full training run and hyperparameter search (randomized search, TimeSeriesSplit).
2. Per-zone error analysis; fix Far West.
3. Compare against ERCOT's own seven-day forecast (API report NP3-565-CD).
4. Grid-analyst agent: tools `get_load`, `get_weather`, `forecast_load`, `what_if`,
   `peak_risk`, `explain`, `draft_briefing`; 20 known-answer test questions.
