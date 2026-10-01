import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { Badge, EmptyState } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { reportReasons } from "@/lib/chat/rules";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Chat reports" };

const filters = [
  { key: "open", label: "Open" },
  { key: "actioned", label: "Action taken" },
  { key: "dismissed", label: "Dismissed" },
] as const;

export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const filter = filters.find((f) => f.key === params.status) ?? filters[0];

  // Admin-only page: reads with the service role after the admin check above.
  const { data, error } = await createAdminClient()
    .from("chat_reports")
    .select(
      "id, reason, details, status, created_at, message_id, conversation_id, reporter:users!chat_reports_reporter_id_fkey(full_name, role), reported:users!chat_reports_reported_user_id_fkey(full_name, role), conversation:conversations(bookings(reference))",
    )
    .eq("status", filter.key)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new AppError("INTERNAL", "Could not load reports.", { cause: error });
  const reports = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Chat reports"
        description="Messages and people reported from booking chats. Opening a chat is logged in the audit log."
      />
      <FilterTabs
        label="Filter reports"
        current={filter.key}
        tabs={filters.map((f) => ({
          key: f.key,
          label: f.label,
          href: adminHref(`/reports?status=${f.key}`),
        }))}
      />
      {reports.length === 0 ? (
        <EmptyState title="No reports here" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={adminHref(`/conversations/${report.conversation_id}?report=${report.id}`)}
                className="flex flex-col gap-1 p-4 hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {reportReasons[report.reason].label}
                    <Badge tone="neutral">{report.message_id ? "Message" : "Person"}</Badge>
                  </span>
                  <span className="block text-sm text-muted">
                    {report.reporter?.full_name ?? "Someone"} reported{" "}
                    {report.reported?.full_name ?? "the other person"}
                    {" · "}
                    {report.conversation?.bookings?.reference}
                  </span>
                  {report.details && <span className="block truncate text-sm">{report.details}</span>}
                </span>
                <span className="shrink-0 text-sm text-muted">{formatDateTime(report.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
