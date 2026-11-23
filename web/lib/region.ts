/** ERCOT weather zones as a user would think of them: by city. Shared by the page and the agent route. */
export type Region = { key: string; name: string; cities: string; lat: number; lon: number };

export const REGIONS: Region[] = [
  { key: "northC", name: "North Central", cities: "Dallas, Fort Worth, Arlington, Waco", lat: 32.8, lon: -97.0 },
  { key: "coast", name: "Coast", cities: "Houston, Galveston, Beaumont", lat: 29.8, lon: -95.4 },
  { key: "southC", name: "South Central", cities: "Austin, San Antonio", lat: 29.9, lon: -98.0 },
  { key: "southern", name: "Southern", cities: "Corpus Christi, Laredo, Brownsville, McAllen", lat: 27.2, lon: -98.2 },
  { key: "east", name: "East", cities: "Tyler, Longview, Lufkin", lat: 32.0, lon: -94.9 },
  { key: "north", name: "North", cities: "Wichita Falls, Denison", lat: 33.8, lon: -98.3 },
  { key: "west", name: "West", cities: "Abilene, San Angelo", lat: 32.0, lon: -100.2 },
  { key: "farWest", name: "Far West", cities: "Midland, Odessa, the Permian Basin", lat: 31.6, lon: -102.6 },
];

export const regionByKey = (k?: string | null) => REGIONS.find((r) => r.key === k) ?? null;

/** Nearest zone centre to a point. Approximate: zone borders are not circles, so the user can override. */
export function nearestRegion(lat: number, lon: number): Region {
  let best = REGIONS[0], bestD = Infinity;
  for (const r of REGIONS) {
    const d = (r.lat - lat) ** 2 + ((r.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

const STORE = "ercot-region-v1";
export function loadRegion(): Region | null {
  try { return regionByKey(localStorage.getItem(STORE)); } catch { return null; }
}
export function saveRegion(r: Region | null) {
  try { if (r) localStorage.setItem(STORE, r.key); else localStorage.removeItem(STORE); } catch { /* private mode */ }
}
