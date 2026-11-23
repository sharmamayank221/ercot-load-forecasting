"use client";
import { useState } from "react";
import { MapPin, LocateFixed } from "lucide-react";
import { REGIONS, nearestRegion, type Region } from "@/lib/region";

/** Choose your ERCOT region, or detect it from the browser's location (asked only when clicked). */
export default function RegionPicker({ region, onChange }: { region: Region | null; onChange: (r: Region | null) => void }) {
  const [msg, setMsg] = useState("");
  const locate = () => {
    if (!navigator.geolocation) { setMsg("Location isn't available in this browser."); return; }
    setMsg("Finding your region…");
    navigator.geolocation.getCurrentPosition(
      (p) => { const r = nearestRegion(p.coords.latitude, p.coords.longitude); onChange(r); setMsg(`Nearest region: ${r.name}. Change it if that's wrong.`); },
      () => setMsg("Location permission was not given; pick your region instead."),
      { timeout: 8000, maximumAge: 600000 });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <MapPin size={16} className="text-heat" />
        <select aria-label="Your region" value={region?.key ?? ""} onChange={(e) => onChange(REGIONS.find((r) => r.key === e.target.value) ?? null)}
          className="rounded-md border border-rule bg-panel px-2 py-1.5 text-[14px]">
          <option value="">All of Texas (no region)</option>
          {REGIONS.map((r) => <option key={r.key} value={r.key}>{r.name}: {r.cities.split(",").slice(0, 2).join(",")}</option>)}
        </select>
        <button onClick={locate} title="Use my location" aria-label="Use my location"
          className="rounded-md border border-rule bg-panel p-1.5 text-muted hover:text-ink"><LocateFixed size={16} /></button>
      </div>
      {msg && <div className="text-[12px] text-muted">{msg}</div>}
    </div>
  );
}
