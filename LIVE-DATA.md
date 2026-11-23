# Live daily data

Every evening a GitHub Actions job (`.github/workflows/daily-refresh.yml`):

1. pulls the latest actual load from the ERCOT Public API and observed weather from Meteostat,
2. gets the hourly weather forecast for today and tomorrow from Open-Meteo (free, no key),
3. forecasts tomorrow for all 8 zones with the trained model (`src/live/refresh.py`),
4. rebuilds the peak-day labels and the site data, commits them, and pushes.

The push redeploys Vercel, and the next morning's `/api/dispatch` emails each zone's subscribers a real
day-ahead briefing. Days whose load is not known yet appear as forecasts everywhere in the app.

## One-time setup

```bash
cd ~/Documents/personalProjects/ercot-load-forecasting
python scripts/pin_live_requirements.py      # writes requirements-live.txt from your Mac's versions
```

Let the job see the trained models (they are small) by adding to `.gitignore`:

```
!outputs/models/
outputs/models/*
!outputs/models/gradient_boosting.joblib
!outputs/models/xgboost.joblib
!outputs/models/best_tuned.joblib
```

```bash
git add .gitignore requirements-live.txt outputs/models .github src scripts web api LIVE-DATA.md
git commit -m "Live daily refresh" && git push
```

In GitHub: **Settings > Secrets and variables > Actions > New repository secret**, add
`ERCOT_USER`, `ERCOT_PASS`, `ERCOT_KEY` (the same ERCOT API account you used to pull the data).

Then **Actions > Daily data refresh > Run workflow** to run it once now. When it finishes, a commit
"Daily data refresh YYYY-MM-DD" appears, Vercel redeploys, and the Forecast page lets you pick tomorrow.

## Test without the internet

```bash
python -m src.live.refresh --simulate 2026-07-21
```
pretends it is July 21, 2026 at 5 pm, uses only local data, and prints the true day-ahead error for
July 22 (about 5.7% on the record day).

## Notes

* Observations stop at the time of the run, so the 48 h and 168 h load lags for tomorrow are always real.
* The weather for tomorrow is a forecast: this is the first time the model sees forecast rather than observed
  weather, so expect live errors somewhat above the 5% test figure.
* Only new rows are committed under `data/live/`; the large base tables never change.
