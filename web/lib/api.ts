/**
 * Data layer. The app is fully static: every page reads precomputed JSON from /public/data
 * (written by scripts/export_static.py). Function names mirror the old FastAPI endpoints so the
 * pages did not have to change. Only the analyst chat calls a server route (/api/agent).
 */
export const ZONES = ["Coast", "East", "Far West", "North", "North Central", "South Central", "Southern", "West"];
export const ZONE_KEYS: Record<string, string> = {
  Coast: "coast", East: "east", "Far West": "farWest", North: "north",
  "North Central": "northC", "South Central": "southC", Southern: "southern", West: "west",
};

const cache = new Map<string, Promise<unknown>>();
export function loadJSON<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(file, fetch(`/data/${file}`).then((r) => {
      if (!r.ok) throw new Error(`missing data file ${file}; run scripts/export_static.py`);
      return r.json();
    }));
  }
  return cache.get(file) as Promise<T>;
}

export type Meta = {
  zones: { key: string; name: string }[]; forecast_start: string; forecast_end: string; shifts: number[];
  model: string; importance_source: string; top_features: [string, number][];
  leaderboard: { model: string; r2: number; mae: number; mape: number }[]; data_start: string; data_end: string;
};
type LoadFile = { zone: string; t: number[]; mw: number[]; temp: (number | null)[] };
type DayRec = {
  hour: number[]; forecast: number[]; actual: number[]; naive: number[]; temp: (number | null)[];
  peak_mw: number; peak_hour: number; mean_mw: number; actual_peak_mw: number; mape_pct: number;
  weather: { temp_high_f: number; temp_low_f: number; humidity_mean_pct: number };
  inputs: Record<string, number | boolean>;
};

const key = (zone: string) => {
  const k = ZONE_KEYS[zone] ?? Object.values(ZONE_KEYS).find((v) => v.toLowerCase() === zone.toLowerCase());
  if (!k) throw new Error(`unknown zone ${zone}`);
  return k;
};
const isoHour = (h: number) => new Date(h * 3_600_000).toISOString().slice(0, 19);
const hourOf = (d: string) => Math.floor(Date.parse(d + "T00:00:00Z") / 3_600_000);

async function dayRecord(zone: string, date: string) {
  const [meta, fc] = await Promise.all([loadJSON<Meta>("meta.json"), loadJSON<Record<string, DayRec>>(`forecast/${key(zone)}.json`)]);
  const r = fc[date];
  if (!r) throw new Error(`forecasts cover ${meta.forecast_start} to ${meta.forecast_end}; pick a date in that range`);
  return { meta, r };
}

/** Same signature as before: get("/api/<endpoint>", params) */
export async function get<T>(path: string, p: Record<string, string | number> = {}): Promise<T> {
  const zone = String(p.zone ?? "North Central");
  switch (path) {
    case "/api/summary": return loadJSON<T>("summary.json");
    case "/api/eda": return loadJSON<T>("eda.json");
    case "/api/peaks": return loadJSON<T>("peaks.json");
    case "/api/profile": return loadJSON<T>(`profile/${key(zone)}.json`);
    case "/api/load": {
      const f = await loadJSON<LoadFile>(`load/${key(zone)}.json`);
      const lo = hourOf(String(p.start)), hi = hourOf(String(p.end)) + 24;
      const points = [];
      for (let i = 0; i < f.t.length; i++) {
        if (f.t[i] >= lo && f.t[i] < hi) points.push({ t: isoHour(f.t[i]), mw: f.mw[i], temp_f: f.temp[i] });
      }
      if (!points.length) throw new Error("no data in that range");
      return { zone: f.zone, points } as T;
    }
    case "/api/forecast": {
      const date = String(p.date);
      const { meta, r } = await dayRecord(zone, date);
      return {
        zone, date, model: meta.model, peak_mw: r.peak_mw, peak_hour: r.peak_hour, mean_mw: r.mean_mw,
        hourly_mw: r.forecast, actual_mw: r.actual, naive_mw: r.naive, temp_f: r.temp,
        actual_peak_mw: r.actual_peak_mw, mape_pct: r.mape_pct, weather: r.weather,
        explain: { top_features: meta.top_features, inputs: r.inputs },
      } as T;
    }
    case "/api/whatif": {
      const date = String(p.date);
      const { meta } = await dayRecord(zone, date);
      const wi = await loadJSON<Record<string, number[][]>>(`whatif/${key(zone)}.json`);
      const rows = wi[date];
      const want = Number(p.temp_shift_f ?? 0);
      const idx = meta.shifts.reduce((b, s, i) => (Math.abs(s - want) < Math.abs(meta.shifts[b] - want) ? i : b), 0);
      const zero = meta.shifts.indexOf(0);
      const peak = (a: number[]) => Math.max(...a);
      return {
        zone, date, temp_shift_f: meta.shifts[idx], base_mw: rows[zero], shifted_mw: rows[idx],
        peak_base: peak(rows[zero]), peak_shifted: peak(rows[idx]),
        curve: meta.shifts.map((s, i) => ({ shift: s, peak_mw: peak(rows[i]) })),
      } as T;
    }
    default: throw new Error(`unknown data path ${path}`);
  }
}

/** Server route call (agent chat). Relative URL: same Vercel deployment. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
/** temperature (°F) -> colour on a cool→heat ramp, used wherever load is coloured by weather */
export function tempColor(t: number) {
  const x = Math.max(0, Math.min(1, (t - 40) / 60));
  const c = [31, 158, 150], h = [230, 97, 42];
  const mix = c.map((a, i) => Math.round(a + (h[i] - a) * x));
  return `rgb(${mix.join(",")})`;
}
