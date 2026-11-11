"""Figures from the saved test predictions.  Run: python -m src.report [--tag _ratio]"""
import argparse
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from src.config import OUT_REPORTS, OUT_FIGURES, TARGET


def main(tag=""):
    preds = pd.read_parquet(OUT_REPORTS / f"test_predictions{tag}.parquet")
    lb = pd.read_csv(OUT_REPORTS / f"leaderboard{tag}.csv")
    best = json.loads((OUT_REPORTS / f"best_model{tag}.json").read_text())["best_on_validation"]

    # 1) leaderboard bars
    t = lb[lb.split == "test"].set_index("model")["MAPE_pct"]
    ax = t.plot(kind="barh", title="Test MAPE by model (2026)", xlabel="MAPE (%)")
    ax.invert_yaxis(); plt.tight_layout()
    plt.savefig(OUT_FIGURES / f"leaderboard{tag}.png", dpi=150); plt.close()

    # 2) record week, North Central, actual vs best model
    wk = preds[(preds.zone == "northC") & preds.timestamp.between("2026-07-20", "2026-07-27")]
    plt.figure(figsize=(10, 4))
    plt.plot(wk.timestamp, wk[TARGET], label="actual")
    plt.plot(wk.timestamp, wk[best], label=f"{best} forecast", alpha=0.8)
    plt.plot(wk.timestamp, wk["naive_last_week"], label="naive (last week)", alpha=0.5)
    plt.title("North Central, week of the 2026 record peak"); plt.ylabel("MW"); plt.legend()
    plt.tight_layout(); plt.savefig(OUT_FIGURES / f"record_week{tag}.png", dpi=150); plt.close()

    # 3) error by hour of day, best model
    e = (preds[best] - preds[TARGET]).abs() / preds[TARGET] * 100
    byh = e.groupby(preds.timestamp.dt.hour).mean()
    byh.plot(title=f"{best}: test MAPE by hour of day", xlabel="hour", ylabel="MAPE (%)")
    plt.tight_layout(); plt.savefig(OUT_FIGURES / f"mape_by_hour{tag}.png", dpi=150); plt.close()
    print("figures written to", OUT_FIGURES)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--tag", default="")
    main(**vars(ap.parse_args()))
