import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { Badge, EmptyState } from "@/components/ui";
import { disputeStatusInfo, type DisputeStatus } from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Disputes" };

const filters: { key: string; label: string; statuses: DisputeStatus[] }[] = [
  { key: "open", label: "Open", statuses: ["open", "under_review"] },
  { key: "closed", label: "Closed", statuses: ["resolved", "rejected"] },
];

export default async function AdminDisputesPage({ searchParams }: PageProps<"/admin/disputes">) {
  await requireAreaAccess("admin");
  const { status } = await searchParams;
  const filter = filters.find((f) => f.key === status) ?? filters[0]!;

  const { data, error } = await createAdminClient()
    .from("disputes")
    .select(
      "id, reason, status, created_at, opener:users!disputes_opened_by_fkey(full_name, role), booking:bookings(reference, business:businesses(name))",
    )
    .in("status", filter.statuses)
    .order("created_at", { ascending: filter.key === "open" })
    .limit(100);
  if (error) throw new AppError("INTERNAL", "Could not load disputes.", { cause: error });
  const disputes = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Disputes"
        description="Problems reported by customers or businesses. The oldest open dispute is first."
      />
      <FilterTabs
        label="Filter disputes"
        current={filter.key}
        tabs={filters.map((f) => ({
          key: f.key,
          label: f.label,
          href: adminHref(`/disputes?status=${f.key}`),
        }))}
      />
      {disputes.length === 0 ? (
        <EmptyState
          title={filter.key === "open" ? "No open disputes" : "No closed disputes yet"}
          description={filter.key === "open" ? "Nothing needs settling right now." : undefined}
        />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {disputes.map((dispute) => (
            <li key={dispute.id}>
              <Link
                href={adminHref(`/disputes/${dispute.id}`)}
                className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{dispute.reason}</span>
                  <span className="block truncate text-sm text-muted">
                    {dispute.booking?.business?.name} · {dispute.booking?.reference} · reported by the{" "}
                    {dispute.opener?.role === "business" ? "business" : "customer"}
                  </span>
                  <span className="block text-xs text-muted">{formatDateTime(dispute.created_at)}</span>
                </span>
                <Badge tone={disputeStatusInfo[dispute.status].tone}>
                  {disputeStatusInfo[dispute.status].label}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
