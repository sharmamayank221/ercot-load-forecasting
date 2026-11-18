# Deploy the web app to Vercel (no Python backend)

The Next.js app in `web/` reads precomputed JSON from `web/public/data/`. Only the analyst
chat runs on the server (`web/app/api/agent/route.ts`), calling a Groq-hosted model.

## 1. Export the data (on your Mac, whenever the models change)

```bash
cd ~/Documents/personalProjects/ercot-load-forecasting
make train && make peak                 # if not already done
python scripts/export_static.py         # writes web/public/data (about 25 MB)
cd web && npm run build && npm run start   # optional local check at http://localhost:3000
```

The export covers load and weather for 2018 to Nov 2026, and forecasts plus what-if scenarios
(−15 to +15 °F in 3 °F steps) for 2025-01-01 to the end of the data. Use `--start 2024-01-01`
for a longer forecast window (files grow proportionally).

## 2. Commit and push

```bash
git add scripts/export_static.py api/main.py web DEPLOY-VERCEL.md
git commit -m "Static Vercel deployment: precomputed data, Groq agent route"
git push
```

`web/public/data` must be committed: it is what Vercel serves.

## 3. Vercel

1. vercel.com -> Add New -> Project -> import `ercot-load-forecasting` from GitHub.
2. **Root Directory: `web`**. Framework: Next.js (auto-detected). Leave build settings as they are.
3. Environment variables (Settings -> Environment Variables), only for the analyst chat:
   * `GROQ_API_KEY` = your key from console.groq.com (free tier)
   * `GROQ_MODEL` = `llama-3.3-70b-versatile` (optional; any Groq model with tool calling)
4. Deploy. Every push to `main` redeploys.

Without a Groq key every page still works; the chat replies that the key is missing.

## Updating

Retrain, rerun `python scripts/export_static.py`, commit, push. Vercel redeploys on its own.
