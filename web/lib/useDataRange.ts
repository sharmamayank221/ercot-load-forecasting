"use client";
import { useEffect, useState } from "react";
import { loadJSON, type Meta } from "@/lib/api";

/** Date limits from meta.json, so date pickers follow the daily refresh (defaults until it loads). */
export function useDataRange() {
  const [r, setR] = useState({ forecastStart: "2025-01-01", forecastEnd: "2026-11-04", dataEnd: "2026-11-04" });
  useEffect(() => {
    loadJSON<Meta>("meta.json").then((m) => setR({ forecastStart: m.forecast_start, forecastEnd: m.forecast_end, dataEnd: m.data_end })).catch(() => {});
  }, []);
  return r;
}
