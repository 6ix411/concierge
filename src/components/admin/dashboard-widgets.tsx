import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "neutral" | "attention";
}) {
  const body = (
    <>
      <span className="text-sm text-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </>
  );
  const className = cn(
    "flex flex-col gap-1 rounded-2xl border bg-surface p-4",
    tone === "attention" ? "border-accent/50 bg-accent/5" : "border-border",
    href && "transition hover:border-foreground/30",
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function StatGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/** A ranked list with proportional bars. */
export function BarList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { key: string; label: ReactNode; detail?: string; value: number; display: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{item.label}</span>
                  {item.detail && <span className="text-muted"> · {item.detail}</span>}
                </span>
                <span className="shrink-0 text-muted tabular-nums">{item.display}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Pill links that filter a list through the URL. */
export function FilterTabs({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="-mx-4 flex gap-1 overflow-x-auto px-4">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
            tab.key === current
              ? "border-foreground bg-surface text-foreground"
              : "border-transparent text-muted hover:bg-surface-muted",
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1 text-muted tabular-nums">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4", className)}>
      {title && <h2 className="font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
