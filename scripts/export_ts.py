"""Time-series structure for the ASDS 5306 (time-series class) version of the site: time-series branch only.

Writes web/public/data/ts_structure.json with
  * ACF of system log load on the training years (2018-2023), lags 1-192, for the log level, the
    lag-24 difference and the regular + lag-24 difference;
  * an additive decomposition (period 24) fitted on 2022-2023 UTC hours, shown for Feb 1-14, 2022,
    plus the multiplicative index range.
Both follow the group report's conventions (UTC hours, training years only) and reproduce its numbers:
ACF 0.940 -> 0.041 at lag 24; seasonal effect about -8,320 to +6,956 MW; index 0.839 to 1.129.

Run: python scripts/export_ts.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.tsa.seasonal import seasonal_decompose
from statsmodels.tsa.stattools import acf

ROOT = Path(__file__).resolve().parents[1]
t = pd.read_parquet(ROOT / "data/processed/ercot_model_table.parquet")

# system series on UTC hours (the repeated fall-back hour is kept distinct via DSTFlag)
x = t[t.zone == "northC"][["timestamp", "DSTFlag", "system_total_mw"]].copy()
local = x.timestamp.dt.tz_localize("America/Chicago", ambiguous=~x.DSTFlag.to_numpy(), nonexistent="NaT")
x["utc"] = local.dt.tz_convert("UTC").dt.tz_localize(None)
s = x.dropna(subset=["utc"]).drop_duplicates("utc").set_index("utc").system_total_mw.sort_index()
s = s.reindex(pd.date_range(s.index.min(), s.index.max(), freq="h")).interpolate(limit=30)

train = np.log(s["2018-01-01":"2023-12-31"])
versions = {"log_level": train, "lag24_diff": train.diff(24), "reg_lag24_diff": train.diff(24).diff(1)}
acfs = {k: [round(float(v), 4) for v in acf(v.dropna(), nlags=192, fft=True)[1:]] for k, v in versions.items()}

seg = s["2022-01-01":"2023-12-31"]
add = seasonal_decompose(seg, model="additive", period=24)
mul = seasonal_decompose(seg, model="multiplicative", period=24)
w = slice("2022-02-01", "2022-02-14 23:00")
win = pd.DataFrame({"observed": add.observed[w], "trend": add.trend[w], "seasonal": add.seasonal[w], "remainder": add.resid[w]})
one_day = add.seasonal["2022-02-01"].round(1).tolist()          # the 24-hour seasonal shape (UTC hours 0-23)

out = {
    "acf": {"lags": list(range(1, 193)), **acfs},
    "decomposition": {
        "window": "2022-02-01 to 2022-02-14 (UTC)", "fit": "2022-2023, additive, period 24 (UTC hours)",
        "t": [ts.strftime("%Y-%m-%dT%H:%M") for ts in win.index],
        **{k: [None if pd.isna(v) else round(float(v), 1) for v in win[k]] for k in win.columns},
        "seasonal_day_utc": one_day,
        "additive_range_mw": [round(float(add.seasonal.min())), round(float(add.seasonal.max()))],
        "multiplicative_range": [round(float(mul.seasonal.min()), 3), round(float(mul.seasonal.max()), 3)],
    },
}
p = ROOT / "web/public/data/ts_structure.json"
p.write_text(json.dumps(out, separators=(",", ":")))
a = out["acf"]
print(f"wrote {p.relative_to(ROOT)} ({p.stat().st_size / 1e3:.0f} kB)")
print(f"ACF lag 24: {a['log_level'][23]:.3f} -> {a['lag24_diff'][23]:.3f}; lag 168 after diff {a['lag24_diff'][167]:.3f}")
print("additive range", out["decomposition"]["additive_range_mw"], "| multiplicative", out["decomposition"]["multiplicative_range"])
