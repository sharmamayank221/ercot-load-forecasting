.PHONY: features train quick peak all app
app:
	streamlit run app/app.py
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
