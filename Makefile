.PHONY: features train quick peak all
features:
	python -m src.features
quick: features
	python -m src.train --quick
train: features
	python -m src.train
peak:
	python -m src.peak_days
all: features train peak
