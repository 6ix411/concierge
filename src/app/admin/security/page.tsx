import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { EmptyState } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { securityEventLabels, type SecurityEvent } from "@/lib/security/events";
import { rateLimits } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Security log" };

const PAGE_SIZE = 50;

const groups = [
  { key: "all", label: "Everything", events: [] },
  {
    key: "auth",
    label: "Sign-in and passwords",
    events: [
      "auth.sign_in_failed",
      "auth.password_changed",
      "auth.password_change_failed",
      "auth.password_reset_requested",
      "auth.password_reset",
    ],
  },
  { key: "limits", label: "Too many requests", events: ["rate_limited"] },
  { key: "uploads", label: "Refused files", events: ["upload.rejected"] },
  { key: "payments", label: "Payments", events: ["webhook.bad_signature", "payment.mismatch"] },
  { key: "ai", label: "AI Concierge", events: ["concierge.blocked_reply"] },
  { key: "roles", label: "Role changes", events: ["role.changed"] },
] as const satisfies { key: string; label: string; events: readonly SecurityEvent[] }[];

function summary(event: string, details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (event === "rate_limited" && typeof d.rule === "string") {
    const rule = rateLimits[d.rule as keyof typeof rateLimits];
    return rule ? `${d.rule} (limit ${rule.limit} per ${rule.windowSeconds / 60} min)` : d.rule;
  }
  if (event === "role.changed") return `${String(d.from)} → ${String(d.to)}`;
  if (event === "payment.mismatch")
    return `${String(d.reference)}: expected ${Number(d.expectedMinor) / 100}, paid ${Number(d.paidMinor) / 100} ${String(d.currency)}`;
  const parts = ["reason", "provider", "bucket"].flatMap((key) =>
    typeof d[key] === "string" ? [d[key]] : [],
  );
  return parts.length ? parts.join(" · ") : null;
}

export default async function AdminSecurityPage({ searchParams }: PageProps<"/admin/security">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const group = groups.find((g) => g.key === params.type) ?? groups[0];
  const before =
    typeof params.before === "string" && !Number.isNaN(Date.parse(params.before)) ? params.before : null;

  let query = createAdminClient()
    .from("security_events")
    .select("id, event, details, ip_hash, created_at, user:users(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (group.events.length > 0) query = query.in("event", [...group.events]);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load the security log.", { cause: error });
  const entries = data ?? [];
  const last = entries.at(-1);
  const typeParam = group.key === "all" ? "" : `type=${group.key}&`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security log"
        description="Failed sign-ins, blocked requests, refused files, payment problems and role changes. Network addresses are stored only as a code, so repeated events from one place can be spotted without keeping the address. Entries can’t be edited or deleted."
      />
      <FilterTabs
        label="Filter the security log"
        current={group.key}
        tabs={groups.map((g) => ({
          key: g.key,
          label: g.label,
          href: adminHref(g.key === "all" ? "/security" : `/security?type=${g.key}`),
        }))}
      />
      {entries.length === 0 ? (
        <EmptyState title="Nothing logged yet" />
      ) : (
        <ol className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {entries.map((entry) => {
            const text = summary(entry.event, entry.details);
            return (
              <li
                key={entry.id}
                className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {securityEventLabels[entry.event as SecurityEvent] ?? entry.event}
                  </p>
                  {text && <p className="break-words text-muted">{text}</p>}
                </div>
                <div className="shrink-0 text-xs text-muted sm:text-right">
                  <p>{entry.user?.full_name ?? entry.user?.email ?? "Not signed in"}</p>
                  {entry.ip_hash && <p>From {entry.ip_hash.slice(0, 8)}</p>}
                  <p>{formatDateTime(entry.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {entries.length === PAGE_SIZE && last && (
        <Link
          href={adminHref(`/security?${typeParam}before=${encodeURIComponent(last.created_at)}`)}
          className="self-start text-sm font-medium hover:underline"
        >
          Older entries
        </Link>
      )}
    </div>
  );
}
