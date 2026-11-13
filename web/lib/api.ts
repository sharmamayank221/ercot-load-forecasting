export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail ?? `${r.status} ${r.statusText}`);
  return r.json();
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const ZONES = ["Coast", "East", "Far West", "North", "North Central", "South Central", "Southern", "West"];
export const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
/** temperature (°F) -> colour on a cool→heat ramp, used wherever load is coloured by weather */
export function tempColor(t: number) {
  const x = Math.max(0, Math.min(1, (t - 40) / 60));
  const c = [31, 158, 150], h = [230, 97, 42];
  const mix = c.map((a, i) => Math.round(a + (h[i] - a) * x));
  return `rgb(${mix.join(",")})`;
}
