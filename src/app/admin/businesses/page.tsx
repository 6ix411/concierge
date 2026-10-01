import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { Container } from "@/components/layout/container";
import { EmptyState } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { businessStatusInfo, type BusinessStatus } from "@/lib/business/status";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Businesses" };

const filters: { key: string; label: string; statuses: BusinessStatus[] }[] = [
  { key: "review", label: "To review", statuses: ["pending", "under_review"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
  { key: "suspended", label: "Suspended", statuses: ["suspended"] },
  { key: "draft", label: "Not submitted", statuses: ["draft"] },
];

export default async function AdminBusinessesPage({ searchParams }: PageProps<"/admin/businesses">) {
  await requireAreaAccess("admin");
  const { status } = await searchParams;
  const filter = filters.find((f) => f.key === status) ?? filters[0]!;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select(
      "id, name, city, state, status, submitted_at, created_at, primary_category:service_categories(name)",
    )
    .in("status", filter.statuses)
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new AppError("INTERNAL", "Could not load businesses.", { cause: error });

  return (
    <Container className="flex flex-col gap-6 py-8">
      <div>
        <Link href={adminHref()} className="text-sm text-muted hover:underline">
          Admin
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
      </div>
      <nav aria-label="Filter businesses" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={adminHref(`/businesses?status=${f.key}`)}
            aria-current={f.key === filter.key ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              f.key === filter.key ? "bg-brand text-brand-foreground" : "text-muted hover:bg-surface-muted",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {(data ?? []).length > 0 ? (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {(data ?? []).map((business) => (
            <li key={business.id}>
              <Link
                href={adminHref(`/businesses/${business.id}`)}
                className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{business.name}</span>
                  <span className="block text-sm text-muted">
                    {[business.primary_category?.name, business.city, business.state]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="block text-xs text-muted">
                    {business.submitted_at
                      ? `Submitted ${formatDate(business.submitted_at)}`
                      : `Started ${formatDate(business.created_at)}`}
                  </span>
                </span>
                <StatusBadge status={business.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={`No ${filter.label.toLowerCase()} businesses`} />
      )}
      <p className="text-xs text-muted">
        Statuses:{" "}
        {Object.values(businessStatusInfo)
          .map((s) => s.label)
          .join(", ")}
        .
      </p>
    </Container>
  );
}
