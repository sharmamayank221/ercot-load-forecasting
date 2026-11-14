"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Compass, LineChart, Thermometer, Flame, MessageSquare, BarChart3 } from "lucide-react";

const items = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/eda", label: "The data", icon: BarChart3 },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/forecast", label: "Forecast", icon: LineChart },
  { href: "/whatif", label: "What-if", icon: Thermometer },
  { href: "/peaks", label: "Peak days", icon: Flame },
  { href: "/analyst", label: "Analyst", icon: MessageSquare },
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
        Hourly load for 8 weather zones, 2018 to Nov 2026. Models: gradient boosting, XGBoost, random forest, stacking.
      </div>
    </aside>
  );
}
