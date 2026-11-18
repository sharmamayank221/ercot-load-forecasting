# Deploying the web app

Front end (Next.js, `web/`) on **Vercel**; backend (FastAPI + models, `api/`) on
**Hugging Face Spaces** (Docker). Both have free tiers.

## 1. Prepare the repo (once)

```bash
cd ~/Documents/personalProjects/ercot-load-forecasting
ls -lh outputs/models/           # check sizes; each must be < 100 MB for GitHub
python scripts/pin_api_requirements.py
```

Let the three models the API uses into git (everything else in outputs/models stays ignored).
Add to the end of `.gitignore`:

```
!outputs/models/
outputs/models/*
!outputs/models/best_tuned.joblib
!outputs/models/gradient_boosting.joblib
!outputs/models/xgboost.joblib
```

```bash
git add .gitignore Dockerfile .dockerignore requirements-api.txt scripts DEPLOY.md outputs/models
git commit -m "Deployment: Dockerfile, pinned API requirements, models"
git push
```

## 2. Backend on Hugging Face Spaces

1. huggingface.co -> New Space -> name `ercot-api`, SDK **Docker**, hardware **CPU basic (free)**.
2. Push the repo to the Space (files over 10 MB must use Git LFS):

```bash
brew install git-lfs && git lfs install
git lfs track "*.parquet" "*.joblib"
git add .gitattributes && git commit -m "LFS for data and models"
git remote add space https://huggingface.co/spaces/YOUR-HF-USERNAME/ercot-api
git push space main
```

   HF asks for a username and an access token (Settings -> Access Tokens, role "write").
3. The Space README needs this header. Add it to the very top of `README.md`:

```
---
title: ERCOT API
sdk: docker
app_port: 7860
---
```

4. Wait for the build (5-10 min). Check `https://YOUR-HF-USERNAME-ercot-api.hf.space/api/summary`
   returns JSON, and `/docs` shows the API.

## 3. Front end on Vercel

1. vercel.com -> Add New -> Project -> import `ercot-load-forecasting` from GitHub.
2. **Root Directory: `web`** (important). Framework is detected as Next.js.
3. Environment variable:
   `NEXT_PUBLIC_API_URL = https://YOUR-HF-USERNAME-ercot-api.hf.space`
4. Deploy. Every `git push` to `main` redeploys automatically.

`NEXT_PUBLIC_` variables are baked in at build time: after changing it, redeploy.

## 4. The agent on the deployed site

Ollama only runs on your laptop, so the Analyst page needs a hosted model:

* **Groq** (free tier, tool-calling Llama models): create a key at console.groq.com, add Space
  secrets `LLM_PROVIDER=groq`, `GROQ_API_KEY=...`, `GROQ_MODEL=llama-3.3-70b-versatile`.
* **Anthropic**: secrets `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`.
* Neither: every other page works; the Analyst page shows "Agent unavailable".

Add Space secrets under Space -> Settings -> Variables and secrets. Never commit keys.

## Notes

* Free Spaces sleep after ~48 h without traffic; the first request then takes about a minute.
* The first `/api/eda` call computes for a few seconds, then it is cached.
* To restrict which sites may call the API, set the Space secret
  `ALLOWED_ORIGINS=https://your-app.vercel.app` (comma-separated for several).
