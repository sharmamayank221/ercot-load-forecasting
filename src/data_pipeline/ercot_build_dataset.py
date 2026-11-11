"""
Build one clean hourly ERCOT load dataset (2018 -> latest).

Sources
  * ERCOT Hourly Load Data Archives (Native_Load_YYYY.xlsx): settled load, primary source
  * ERCOT Public API pull (ercot_load_api_2023-12_to_now.csv): only for days after the
    last archive day, so the whole series comes from one consistent source where possible

Output columns
  timestamp (start of hour, Central prevailing time), DSTFlag (True on the repeated
  November hour), coast, east, farWest, north, northC, southern, southC, west, total (MW),
  source ('archive' or 'api'), uri_flag (True during Winter Storm Uri load shed window)

Usage
  Put this script next to the unzipped Native_Load_*.xlsx files and the API CSV, then:
    pip install pandas openpyxl pyarrow
    python3 ercot_build_dataset.py
"""

import glob
import pandas as pd

ARCHIVE_GLOB = "Native_Load_*.xlsx"
API_CSV = "ercot_load_api_2023-12_to_now.csv"
OUT = "ercot_hourly_load_2018_to_now"

ZONES = {"COAST": "coast", "EAST": "east", "FWEST": "farWest", "NORTH": "north",
         "NCENT": "northC", "SOUTH": "southern", "SCENT": "southC", "WEST": "west",
         "ERCOT": "total"}
URI_START, URI_END = "2021-02-14", "2021-02-20"   # rolling outages; recorded load < true demand


def parse_archive(path):
    df = pd.read_excel(path)
    col = df.columns[0]   # 'HourEnding' in 2018, 'Hour Ending' later
    # a few cells are stored as real Excel dates instead of text
    raw = df[col].map(lambda v: v.strftime("%m/%d/%Y %H:%M") if hasattr(v, "strftime") else str(v))
    raw = raw.str.strip()
    dst = raw.str.endswith("DST")                  # repeated November hour
    s = raw.str.replace(" DST", "", regex=False)
    day = pd.to_datetime(s.str.slice(0, 10), format="%m/%d/%Y")
    hour_ending = s.str.slice(11, 13).astype(int)  # 01..24
    out = df.rename(columns=ZONES)[list(ZONES.values())]
    out.insert(0, "timestamp", day + pd.to_timedelta(hour_ending - 1, unit="h"))
    out.insert(1, "DSTFlag", dst.values)
    out["source"] = "archive"
    return out


def main():
    files = sorted(glob.glob(ARCHIVE_GLOB))
    if not files:
        raise SystemExit(f"No files matching {ARCHIVE_GLOB} in this folder.")
    arch = pd.concat([parse_archive(f) for f in files], ignore_index=True)
    print(f"Archive: {len(files)} files, {len(arch)} rows, "
          f"{arch.timestamp.min()} -> {arch.timestamp.max()}")

    api = pd.read_csv(API_CSV, parse_dates=["timestamp"])
    api["DSTFlag"] = api["DSTFlag"].astype(str).str.lower().eq("true")
    api = api[["timestamp", "DSTFlag"] + list(ZONES.values())]
    api["source"] = "api"

    # how closely the two sources agree where they overlap
    m = arch.merge(api, on=["timestamp", "DSTFlag"], suffixes=("_arch", "_api"))
    if len(m):
        diff = (m.total_api - m.total_arch) / m.total_arch * 100
        print(f"Overlap {len(m)} h: API total is on average {diff.mean():.2f}% vs archive "
              f"(mean absolute {diff.abs().mean():.2f}%)")

    # archive wherever it exists; API only after the last archive hour
    last_arch = arch.timestamp.max()
    df = pd.concat([arch, api[api.timestamp > last_arch]], ignore_index=True)
    df = (df.drop_duplicates(subset=["timestamp", "DSTFlag"])
            .sort_values(["timestamp", "DSTFlag"]).reset_index(drop=True))
    df["uri_flag"] = df.timestamp.between(URI_START, f"{URI_END} 23:00")

    # gap report (one missing hour each March = daylight saving, expected)
    full = pd.date_range(df.timestamp.min(), df.timestamp.max(), freq="h")
    miss = pd.Series(full.difference(df.timestamp))
    by_day = miss.dt.date.value_counts().sort_index()
    real_gaps = by_day[by_day > 1]
    print(f"\nFinal: {len(df)} rows, {df.timestamp.min()} -> {df.timestamp.max()}")
    print("Rows by source:", df.source.value_counts().to_dict())
    print("Daylight-saving missing hours:", int((by_day == 1).sum()))
    print("Real gaps:", "none" if real_gaps.empty else real_gaps.to_dict())

    df.to_csv(f"{OUT}.csv", index=False)
    df.to_parquet(f"{OUT}.parquet", index=False)
    print(f"Saved {OUT}.csv and {OUT}.parquet")


if __name__ == "__main__":
    main()
