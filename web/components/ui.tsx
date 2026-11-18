import { ReactNode } from "react";

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-[34px] font-extrabold leading-none tracking-tight">{children}</h1>
      {sub && <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">{sub}</p>}
    </header>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="border-l-2 pl-4" style={{ borderColor: accent ? "var(--heat)" : "var(--rule)" }}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="num mt-1 text-[28px] font-extrabold leading-none">{value}</div>
      {hint && <div className="mt-1 text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-10 border-t border-rule pt-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {aside && <div className="text-[13px] text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted">
      {label}
      {children}
    </label>
  );
}

export const inputCls = "rounded-md border border-rule bg-panel px-3 py-2 text-[15px] text-ink";

export function ErrorNote({ error }: { error: string }) {
  return <div className="rounded-md border border-heat bg-heat-soft px-4 py-3 text-[14px]">{error}</div>;
}

export function Loading() {
  return <div className="h-40 animate-pulse rounded-md bg-rule/40" />;
}
