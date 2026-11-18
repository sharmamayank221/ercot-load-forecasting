# %% [markdown]
# # EDA: ERCOT hourly load and weather
# %%
import pandas as pd, matplotlib.pyplot as plt
from src.config import MODEL_TABLE, OUT_FIGURES
df = pd.read_parquet(MODEL_TABLE)
df.head()
# %% yearly growth
sys = df[df.zone == "northC"].set_index("timestamp")["system_total_mw"]
g = sys.groupby(sys.index.year).agg(["mean", "max"])
g.plot(kind="bar", title="ERCOT system load by year (MW)"); plt.tight_layout()
plt.savefig(OUT_FIGURES / "yearly_load.png", dpi=150)
# %% temperature vs load (North Central, summer)
nc = df[(df.zone == "northC") & df.timestamp.dt.month.isin([6, 7, 8])]
plt.figure(); plt.scatter(nc.temp_f, nc.load_mw, s=2, alpha=0.2)
plt.xlabel("temperature (°F)"); plt.ylabel("North Central load (MW)"); plt.title("Summer hours")
plt.savefig(OUT_FIGURES / "temp_vs_load_northC.png", dpi=150)
# %% one week in July 2026
wk = df[(df.zone == "northC") & df.timestamp.between("2026-07-20", "2026-07-27")]
ax = wk.plot(x="timestamp", y="load_mw", title="North Central, week of the 2026 record peak")
wk.plot(x="timestamp", y="temp_f", secondary_y=True, ax=ax)
plt.savefig(OUT_FIGURES / "record_week_northC.png", dpi=150)
