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
src/tune.py       randomized search + peak-hour weighting -> python -m src.tune
src/report.py     figures from test predictions -> python -m src.report --tag _ratio
src/agent/        agent tools, LangChain agent, known-answer evaluation questions
app/app.py        Streamlit dashboard -> streamlit run app/app.py
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
make train     # full model ladder (several minutes; add --trees 60 --ratio-target on a laptop)
make peak      # high-peak-day label and classifier
pytest -q      # sanity checks
streamlit run app/app.py   # dashboard at http://localhost:8501
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

## Results (full data, `python -m src.train --trees 60 --ratio-target`, test = Jan–Nov 2026)

Target is predicted as a ratio to the 7-day rolling load and scaled back (`--ratio-target`):
plain-MW targets let tree models under-predict the newest, highest-demand year.

| model | R² | RMSE (MW) | MAE (MW) | MAPE |
| --- | --- | --- | --- | --- |
| naive, same hour last week | 0.957 | 1,267 | 677 | 9.05% |
| decision tree | 0.983 | 801 | 467 | 6.57% |
| bagging | 0.987 | 689 | 414 | 5.95% |
| random forest | 0.988 | 659 | 397 | 5.68% |
| **gradient boosting** | **0.994** | **487** | **320** | 5.18% |
| XGBoost | 0.993 | 521 | 329 | **5.11%** |
| stacking (RF + XGB + GB → ridge) | 0.987 | 695 | 403 | 5.50% |

Best on validation (2025): gradient boosting. Its 2026 error by zone and season:

| zone | MAPE | | season | MAPE |
| --- | --- | --- | --- | --- |
| Coast | 3.2% | | spring | 4.9% |
| North Central | 4.4% | | summer | 4.0% |
| South Central | 4.8% | | fall | 6.1% |
| Far West | 4.0% | | winter | 6.5% |
| West | 8.2% | | | |

Peak-day classifier (growth-adjusted label, test = 2025–26): XGBoost recall 0.64 / precision 0.87 /
F1 0.74 / PR-AUC 0.85; seasonal-naive baseline F1 0.17. See `outputs/reports/`.

Figures: `outputs/figures/record_week_ratio.png` (actual vs forecast vs naive in the week of
the 2026 record peak), `leaderboard_ratio.png`, `mape_by_hour_ratio.png`.

### Tuning and peak weighting (`python -m src.tune --n-iter 4`, 20 fits)
Randomized search over gradient boosting and XGBoost, selected on the 2025 validation year.
Best: gradient boosting (1,500 iterations, lr 0.08, 127 leaves, peak-weighted) with
validation MAPE 4.39% and test MAPE 5.13% (default: 4.65% / 5.18%). Weighting summer
afternoons ×3 cut peak-hour test MAPE from 4.5% to 4.2–4.4% at a small cost elsewhere.
The gains are small: the models are close to what these features allow, so the next step
is better features (real weather forecasts, holidays around weekends) rather than more tuning.

### Grid-analyst agent (`src/agent/`)
Seven tools over the data and the tuned model: `get_load`, `get_weather`, `forecast_load`,
`what_if`, `peak_risk`, `explain`, `model_card`. `tests/test_tools.py` checks them without an
LLM; `src/agent/eval_questions.json` holds the known-answer questions used to score the agent.
Run the agent with `python -m src.agent.agent "your question"` after
`pip install langchain langchain-anthropic langgraph python-dotenv` and setting
`ANTHROPIC_API_KEY` in `.env`.

### Dashboard (`app/app.py`)
Six pages: **Overview** (growth, leaderboard, zone shares), **Explore data** (load vs
temperature for any zone and date range, month×hour heat map), **Forecast** (actual vs
model vs naive for any zone-day, with error breakdowns), **What-if** (temperature slider and
sensitivity curve), **Peak days** (daily peaks against the rolling cutoff, classifier
results) and **Ask the analyst** (chat with the agent, or call any tool directly).
Needs `make train` and `make peak` to have run; the agent page needs `ANTHROPIC_API_KEY`.

### Findings so far
* **Demand growth is the main modelling problem.** With a plain MW target, Far West (oil, gas
  and data-centre growth) had R² < 0 and tree stacking failed (13.8% MAPE) because trees cannot
  predict above the training range. The ratio target fixed both; zone×trend features did not.
* **Stacking does not beat its best member yet.** Its out-of-fold predictions come from early,
  smaller training windows; a linear meta-learner was needed to extrapolate at all.
* **Peaks are under-forecast.** On the record week the model tracks the shape but misses the
  top of the highest afternoons by ~2,000 MW (see figure): a candidate for quantile loss or
  extra weight on summer afternoons.
* **Winter and fall are the weakest seasons** (6–6.5% MAPE) and West the weakest zone.
* Weather features are *observed*; real day-ahead forecasts will be noisier.

## Roadmap

1. Per-zone models for West and North; quantile loss for peak hours.
2. Stacking: wider out-of-fold windows or train the meta-learner on 2025 only.
3. Compare against ERCOT's own seven-day forecast (API report NP3-565-CD).
4. Agent: run the known-answer evaluation with a live LLM, add `draft_briefing`, grow the
   question set to 20.
