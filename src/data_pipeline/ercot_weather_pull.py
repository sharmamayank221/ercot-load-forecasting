"""
Hourly weather for the 8 ERCOT weather zones (2018 -> yesterday), aligned to ERCOT hours,
then joined with the load file into one modeling table.

Source: Meteostat (free, no API key; serves NOAA ISD + other station observations).

Usage
  pip install "meteostat<2" pandas pyarrow
  python3 ercot_weather_pull.py

Outputs
  weather_hourly_2018_to_now.parquet / .csv   wide: timestamp, DSTFlag, temp_coast, ...
  ercot_model_table.parquet / .csv            long: one row per hour per zone with load + weather
                                              (only if ercot_hourly_load_2018_to_now.parquet is here)
"""

from datetime import date, datetime, timedelta
import os

import pandas as pd
from meteostat import Hourly, Stations

START = datetime(2018, 1, 1)
END = datetime.combine(date.today() - timedelta(days=1), datetime.max.time())
LOAD_FILE = "ercot_hourly_load_2018_to_now.parquet"
OUT_WEATHER = "weather_hourly_2018_to_now"
OUT_TABLE = "ercot_model_table"

# One representative airport per ERCOT weather zone (main load centre of the zone)
ZONE_STATIONS = {
    "coast":    ("KIAH", "Houston Intercontinental", 29.98,  -95.34),
    "east":     ("KTYR", "Tyler Pounds Regional",    32.35,  -95.40),
    "farWest":  ("KMAF", "Midland International",    31.94, -102.19),
    "north":    ("KSPS", "Wichita Falls",            33.98,  -98.49),
    "northC":   ("KDFW", "Dallas/Fort Worth Intl",   32.90,  -97.04),
    "southC":   ("KAUS", "Austin-Bergstrom",         30.19,  -97.67),
    "southern": ("KCRP", "Corpus Christi Intl",      27.77,  -97.50),
    "west":     ("KABI", "Abilene Regional",         32.41,  -99.68),
}
VARS = ["temp", "dwpt", "rhum", "wspd", "prcp"]   # °C, °C, %, km/h, mm


def pick_station(icao, lat, lon):
    """Prefer the named airport; otherwise the nearest station with hourly data for the period."""
    near = Stations().nearby(lat, lon).inventory("hourly", (START, END)).fetch(10)
    if near.empty:
        near = Stations().nearby(lat, lon).fetch(10)
    match = near[near["icao"] == icao]
    row = match.iloc[0] if len(match) else near.iloc[0]
    return row.name, row["name"], row.get("icao"), row.get("distance", float("nan"))


def to_ercot_hours(df_utc):
    """UTC hourly index -> ERCOT convention: naive local (Central) hour start + DSTFlag.

    On the November fall-back day the 1 am local hour happens twice; ERCOT marks the
    second one with DSTFlag=True. Spring-forward hour simply doesn't exist.
    """
    idx = pd.DatetimeIndex(df_utc.index).tz_localize("UTC").tz_convert("America/Chicago")
    out = df_utc.copy()
    out["timestamp"] = idx.tz_localize(None)
    out["DSTFlag"] = out.duplicated(subset="timestamp", keep="first")
    return out.reset_index(drop=True)


def fetch_zone(zone, icao, label, lat, lon):
    sid, sname, sicao, dist = pick_station(icao, lat, lon)
    note = "" if sicao == icao else f"  (fallback for {icao})"
    print(f"{zone:9s} -> {sid} {sname} [{sicao}] {dist/1000 if dist == dist else 0:.1f} km{note}")
    # pull a day either side so local-time conversion has full coverage at the edges
    raw = Hourly(sid, START - timedelta(days=1), END + timedelta(days=1)).fetch()
    raw = raw[[v for v in VARS if v in raw.columns]]
    full = pd.date_range(raw.index.min(), raw.index.max(), freq="h")
    raw = raw.reindex(full)
    before = raw["temp"].isna().sum()
    # fill short gaps only (<= 3 h); precipitation gaps -> 0
    raw[[c for c in raw.columns if c != "prcp"]] = (
        raw[[c for c in raw.columns if c != "prcp"]].interpolate(limit=3, limit_direction="both"))
    if "prcp" in raw:
        raw["prcp"] = raw["prcp"].fillna(0)
    after = raw["temp"].isna().sum()
    print(f"           temp gaps: {before} h before fill, {after} h after (gaps > 3 h left blank)")
    w = to_ercot_hours(raw)
    w = w[(w.timestamp >= START) & (w.timestamp <= END)]
    w = w.rename(columns={v: f"{v}_{zone}" for v in VARS})
    return w, {"zone": zone, "station_id": sid, "station": sname, "icao": sicao}


def main():
    frames, chosen = [], []
    for zone, (icao, label, lat, lon) in ZONE_STATIONS.items():
        w, info = fetch_zone(zone, icao, label, lat, lon)
        frames.append(w.set_index(["timestamp", "DSTFlag"]))
        chosen.append(info)

    weather = pd.concat(frames, axis=1).reset_index().sort_values(["timestamp", "DSTFlag"])
    weather.to_parquet(f"{OUT_WEATHER}.parquet", index=False)
    weather.to_csv(f"{OUT_WEATHER}.csv", index=False)
    pd.DataFrame(chosen).to_csv("weather_stations_used.csv", index=False)
    print(f"\nWeather: {len(weather)} rows x {weather.shape[1]} cols -> {OUT_WEATHER}.parquet")

    if not os.path.exists(LOAD_FILE):
        print(f"{LOAD_FILE} not found here; skipped the join.")
        return

    load = pd.read_parquet(LOAD_FILE)
    zones = list(ZONE_STATIONS)
    # long format: one row per hour per zone
    load_long = load.melt(id_vars=["timestamp", "DSTFlag", "source", "uri_flag", "total"],
                          value_vars=zones, var_name="zone", value_name="load_mw")
    wl = []
    for z in zones:
        cols = {f"{v}_{z}": v for v in VARS if f"{v}_{z}" in weather.columns}
        part = weather[["timestamp", "DSTFlag"] + list(cols)].rename(columns=cols)
        part["zone"] = z
        wl.append(part)
    weather_long = pd.concat(wl, ignore_index=True)

    table = (load_long.merge(weather_long, on=["timestamp", "DSTFlag", "zone"], how="left")
                      .rename(columns={"total": "system_total_mw"})
                      .sort_values(["zone", "timestamp", "DSTFlag"]).reset_index(drop=True))
    table.to_parquet(f"{OUT_TABLE}.parquet", index=False)
    table.to_csv(f"{OUT_TABLE}.csv", index=False)

    print(f"Model table: {len(table)} rows x {table.shape[1]} cols -> {OUT_TABLE}.parquet")
    miss = table.groupby("zone")["temp"].apply(lambda s: s.isna().mean() * 100).round(2)
    print("Share of hours with no temperature, by zone (%):")
    print(miss.to_string())


if __name__ == "__main__":
    main()
