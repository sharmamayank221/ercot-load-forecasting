.PHONY: features train quick peak all app api web
app:
	streamlit run app/app.py
api:
	uvicorn api.main:app --reload --port 8000
web:
	cd web && npm run dev
features:
	python -m src.features
quick: features
	python -m src.train --quick
train: features
	python -m src.train --ratio-target
peak:
	python -m src.peak_days
report:
	python -m src.report --tag _ratio
all: features train peak report
