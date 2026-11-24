"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Compass, Trophy, Waves } from "lucide-react";

const items = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/eda", label: "The data", icon: BarChart3 },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/structure", label: "Structure", icon: Waves },
  { href: "/models", label: "Models & results", icon: Trophy },
];

export default function Nav() {
  const path = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-rule bg-panel px-5 py-8 flex flex-col gap-8">
      <div>
        <div className="text-[13px] text-muted">Texas grid</div>
        <div className="text-xl font-extrabold leading-tight">ERCOT demand<br />forecasting</div>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors ${active ? "bg-ink text-paper font-semibold" : "text-ink hover:bg-paper"}`}>
              <Icon size={17} strokeWidth={active ? 2.4 : 1.8} />{label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto text-[12px] leading-relaxed text-muted">
        ASDS 5306 Applied Time Series Analysis · Group 3. Hourly load for the system and 8 weather zones, 2018 to Nov 2026.
      </div>
    </aside>
  );
}
