# Backend (FastAPI + models) for Hugging Face Spaces or any Docker host.
FROM python:3.13-slim

# OpenMP runtime for XGBoost and scikit-learn's gradient boosting
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

COPY src ./src
COPY api ./api
COPY data/processed ./data/processed
COPY outputs ./outputs

# Rebuild the two derived tables that are not committed to git
RUN python -m src.features && python -m src.peak_days

ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
