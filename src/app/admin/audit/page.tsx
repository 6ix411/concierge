import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { EmptyState } from "@/components/ui";
import { auditLabel, auditTargets } from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

/** Where an entry's target lives in the dashboard, when it has a page. */
function targetHref(type: string, id: string | null): string | null {
  if (!id) return null;
  const pages: Record<string, string> = {
    businesses: "/businesses/",
    bookings: "/bookings/",
    disputes: "/disputes/",
    users: "/users/",
  };
  if (pages[type]) return adminHref(`${pages[type]}${id}`);
  if (type === "reviews") return adminHref("/reviews?status=all");
  if (type === "service_categories") return adminHref("/categories");
  if (type === "platform_settings") return adminHref("/commission");
  return null;
}

/** A short, readable summary of the details stored with an entry. */
function details(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["reference", "name", "email", "business"])
    if (typeof m[key] === "string") parts.push(m[key]);
  if (typeof m.newBps === "number" || m.newBps === null)
    parts.push(
      `${typeof m.previousBps === "number" ? `${m.previousBps / 100}%` : "default"} → ${typeof m.newBps === "number" ? `${m.newBps / 100}%` : "default"}`,
    );
  if (typeof m.refundDueMinor === "number" && m.refundDueMinor > 0)
    parts.push(`refund due ₦${(m.refundDueMinor / 100).toLocaleString("en-NG")}`);
  return parts.length ? parts.join(" · ") : null;
}

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const target = auditTargets.find((t) => t.key === params.type)?.key ?? "all";
  const before =
    typeof params.before === "string" && !Number.isNaN(Date.parse(params.before)) ? params.before : null;

  let query = createAdminClient()
    .from("admin_actions")
    .select(
      "id, action, target_type, target_id, reason, metadata, created_at, admin:users!admin_actions_admin_id_fkey(full_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (target !== "all") query = query.eq("target_type", target);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load the audit log.", { cause: error });
  const entries = data ?? [];
  const last = entries.at(-1);
  const typeParam = target === "all" ? "" : `type=${target}&`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every important admin action, who took it and why. Entries can’t be edited or deleted."
      />
      <FilterTabs
        label="Filter the audit log"
        current={target}
        tabs={[{ key: "all", label: "Everything" }, ...auditTargets].map((t) => ({
          key: t.key,
          label: t.label,
          href: adminHref(t.key === "all" ? "/audit" : `/audit?type=${t.key}`),
        }))}
      />
      {entries.length === 0 ? (
        <EmptyState title="Nothing logged yet" />
      ) : (
        <ol className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {entries.map((entry) => {
            const href = targetHref(entry.target_type, entry.target_id);
            const summary = details(entry.metadata);
            return (
              <li
                key={entry.id}
                className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {auditLabel(entry.action)}
                      </Link>
                    ) : (
                      auditLabel(entry.action)
                    )}
                  </p>
                  {summary && <p className="text-muted">{summary}</p>}
                  {entry.reason && <p className="text-muted">“{entry.reason}”</p>}
                </div>
                <div className="shrink-0 text-xs text-muted sm:text-right">
                  <p>{entry.admin?.full_name ?? entry.admin?.email}</p>
                  <p>{formatDateTime(entry.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {entries.length === PAGE_SIZE && last && (
        <Link
          href={adminHref(`/audit?${typeParam}before=${encodeURIComponent(last.created_at)}`)}
          className="self-start text-sm font-medium hover:underline"
        >
          Older entries
        </Link>
      )}
    </div>
  );
}
