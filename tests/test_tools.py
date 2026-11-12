"""Tool-level tests: the agent's tools return correct, consistent numbers (no LLM needed)."""
import json
from pathlib import Path
import pytest
from src.agent import tools as T


def test_get_load_matches_model_table():
    r = T.get_load("North Central", "2026-07-22", "2026-07-22")
    assert r["hours"] == 24 and r["max_mw"] == 29344 and r["peak_time"].startswith("2026-07-22 16")


def test_forecast_shape_and_accuracy():
    r = T.forecast_load("Coast", "2026-07-22")
    assert len(r["hourly_mw"]) == 24 and r["mape_pct"] < 10


def test_what_if_hotter_raises_summer_load():
    r = T.what_if("South Central", "2026-08-15", 5)
    assert r["peak_change_mw"] > 0


def test_unknown_zone_rejected():
    with pytest.raises(ValueError):
        T.get_weather("Mars", "2026-07-22")


def test_out_of_range_date_rejected():
    with pytest.raises(ValueError):
        T.forecast_load("Southern", "2030-01-01")


def test_eval_questions_tools_run():
    qs = json.loads((Path(__file__).parents[1] / "src/agent/eval_questions.json").read_text())
    for q in qs:
        c = q["check"]
        if c.get("expect_refusal"):
            continue
        out = getattr(T, c["tool"])(**c["args"])
        assert c["field"] in out, q["q"]
