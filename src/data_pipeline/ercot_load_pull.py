"""
ERCOT hourly load by weather zone (NP6-345-CD) — full pull + gap fill.

What it does
  1. Signs in to the ERCOT Public API (token refreshed automatically).
  2. If the CSV doesn't exist yet, pulls Dec 11 2023 -> yesterday month by month.
     If it does exist, only pulls days after the last day in the file.
  3. Finds any whole or partial days that are missing and re-pulls them one day at a time.
  4. Builds a timestamp column, removes duplicates, saves CSV + Parquet,
     and prints a gap report.

Before running (Terminal, same window):
  export ERCOT_USER="your-ercot-email"
  export ERCOT_PASS="your-ercot-password"
  export ERCOT_KEY="your-primary-key"
  pip install pandas requests pyarrow

Run:
  python3 ercot_load_pull.py
"""

import os
import time
from datetime import date, timedelta

import pandas as pd
import requests

# ---------------------------------------------------------------- settings
OUT_CSV = "ercot_load_api_2023-12_to_now.csv"
OUT_PARQUET = "ercot_load_api_2023-12_to_now.parquet"
API_START = pd.Timestamp("2023-12-11")          # earliest date the Public API serves
END = pd.Timestamp(date.today() - timedelta(days=1))

AUTH_URL = ("https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/"
            "B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token")
CLIENT_ID = "fec253ea-0d06-4272-a5e6-b478baeecd70"
DATA_URL = "https://api.ercot.com/api/public-reports/np6-345-cd/act_sys_load_by_wzn"


# ---------------------------------------------------------------- auth
class Session:
    """Holds headers and refreshes the token before it expires (~1 hour)."""

    def __init__(self):
        for var in ("ERCOT_USER", "ERCOT_PASS", "ERCOT_KEY"):
            if var not in os.environ:
                raise SystemExit(f"Missing environment variable {var}. "
                                 "Run the export lines at the top of this file first.")
        self.headers, self.t = None, 0
        self.refresh()

    def refresh(self):
        r = requests.post(AUTH_URL, data={
            "username": os.environ["ERCOT_USER"].strip(),
            "password": os.environ["ERCOT_PASS"].strip(),
            "grant_type": "password",
            "scope": f"openid {CLIENT_ID} offline_access",
            "client_id": CLIENT_ID,
            "response_type": "id_token",
        }, timeout=60)
        r.raise_for_status()
        self.headers = {
            "Authorization": f"Bearer {r.json()['id_token']}",
            "Ocp-Apim-Subscription-Key": os.environ["ERCOT_KEY"].strip(),
        }
        self.t = time.time()
        print("Signed in to ERCOT API.")

    def get(self, params):
        """GET with token refresh, rate-limit backoff and retries."""
        for attempt in range(6):
            if time.time() - self.t > 50 * 60:
                self.refresh()
            try:
                r = requests.get(DATA_URL, headers=self.headers, params=params, timeout=120)
            except requests.exceptions.InvalidHeader as e:
                raise SystemExit(f"Bad header value (check ERCOT_KEY for spaces/quotes): {e}")
            except requests.RequestException as e:
                print("  network error, retrying:", e)
                time.sleep(10 * (attempt + 1))
                continue
            if r.status_code == 401:
                self.refresh()
                continue
            if r.status_code == 429 or r.status_code >= 500:
                wait = 30 * (attempt + 1)
                print(f"  HTTP {r.status_code}, waiting {wait}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"Failed after retries: {params}")


# ---------------------------------------------------------------- fetching
def fetch_range(s, start, end):
    """All rows for operating days start..end (inclusive), all pages."""
    frames, page = [], 1
    while True:
        j = s.get({
            "operatingDayFrom": start.strftime("%Y-%m-%d"),
            "operatingDayTo": end.strftime("%Y-%m-%d"),
            "page": page,
        })
        cols = [f["name"] for f in j["fields"]]
        frames.append(pd.DataFrame(j["data"], columns=cols))
        total_pages = j["_meta"].get("totalPages", 1) or 1
        if page >= total_pages:
            break
        page += 1
        time.sleep(1)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch_months(s, start, end):
    frames = []
    for m in pd.date_range(start.to_period("M").to_timestamp(), end, freq="MS"):
        a = max(m, start)
        b = min(m + pd.offsets.MonthEnd(0), end)
        df = fetch_range(s, a, b)
        print(f"{a:%Y-%m-%d} -> {b:%Y-%m-%d}: {len(df)} rows")
        frames.append(df)
        time.sleep(2)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


# ---------------------------------------------------------------- cleaning
def add_timestamp(df):
    """Timestamp = start of the hour. Hour-ending 01:00 -> 00:00, 24:00 -> 23:00."""
    df = df.copy()
    df["DSTFlag"] = df["DSTFlag"].astype(str).str.lower().eq("true")
    hr = df["hourEnding"].astype(str).str.slice(0, 2).astype(int)
    df["timestamp"] = pd.to_datetime(df["operatingDay"]) + pd.to_timedelta(hr - 1, unit="h")
    return df


def tidy(df):
    return (df.drop_duplicates(subset=["timestamp", "DSTFlag"])
              .sort_values(["timestamp", "DSTFlag"])
              .reset_index(drop=True))


def missing_days(df):
    """Days with fewer than 23 distinct hours (23 is normal on the spring DST day)."""
    full_days = pd.date_range(df["timestamp"].min().normalize(), END, freq="D")
    counts = df.groupby(df["timestamp"].dt.normalize())["timestamp"].nunique()
    counts = counts.reindex(full_days, fill_value=0)
    return list(counts[counts < 23].index)


def gap_report(df):
    full = pd.date_range(df["timestamp"].min(), df["timestamp"].max(), freq="h")
    miss = pd.Series(full.difference(df["timestamp"]))
    print("\n---- gap report ----")
    print("rows:", len(df), "| columns:", df.shape[1])
    print("range:", df["timestamp"].min(), "->", df["timestamp"].max())
    if miss.empty:
        print("missing hours: none")
    else:
        by_day = miss.dt.date.value_counts().sort_index()
        print("missing hours by day (1 hour in March = daylight saving, expected):")
        print(by_day.to_string())
    print("duplicate hours (November fall-back, expected):",
          int(df["timestamp"].duplicated().sum()))


# ---------------------------------------------------------------- main
def main():
    s = Session()

    # 1) load existing file or pull everything
    if os.path.exists(OUT_CSV):
        df = pd.read_csv(OUT_CSV, parse_dates=["timestamp"])
        df = add_timestamp(df)
        last_day = df["timestamp"].max().normalize()
        print(f"Loaded {len(df)} rows from {OUT_CSV}, last day {last_day:%Y-%m-%d}")
        if last_day < END:
            new = fetch_months(s, last_day + pd.Timedelta(days=1), END)
            if not new.empty:
                df = pd.concat([df, add_timestamp(new)], ignore_index=True)
    else:
        print("No existing file, pulling full history from the API...")
        df = add_timestamp(fetch_months(s, API_START, END))

    df = tidy(df)

    # 2) re-pull any missing or incomplete days, one day at a time
    gaps = missing_days(df)
    if gaps:
        print(f"\nRe-pulling {len(gaps)} incomplete day(s):",
              ", ".join(d.strftime("%Y-%m-%d") for d in gaps))
        for d in gaps:
            day_df = fetch_range(s, d, d)
            print(f"  {d:%Y-%m-%d}: {len(day_df)} rows returned")
            if not day_df.empty:
                df = pd.concat([df, add_timestamp(day_df)], ignore_index=True)
            time.sleep(2)
        df = tidy(df)
        still = missing_days(df)
        if still:
            print("Still missing after re-pull (fill these from the ERCOT archive files):",
                  ", ".join(d.strftime("%Y-%m-%d") for d in still))

    # 3) save
    df.to_csv(OUT_CSV, index=False)
    try:
        df.to_parquet(OUT_PARQUET, index=False)
    except ImportError:
        print("pyarrow not installed; skipped Parquet (pip install pyarrow)")
    print(f"\nSaved {OUT_CSV}" + (f" and {OUT_PARQUET}" if os.path.exists(OUT_PARQUET) else ""))

    gap_report(df)


if __name__ == "__main__":
    main()
