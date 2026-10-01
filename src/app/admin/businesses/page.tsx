import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { SearchForm } from "@/components/admin/search-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { businessStatusInfo, type BusinessStatus } from "@/lib/business/status";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Businesses" };

const filters: { key: string; label: string; statuses: BusinessStatus[] }[] = [
  { key: "review", label: "To review", statuses: ["pending", "under_review"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
  { key: "suspended", label: "Suspended", statuses: ["suspended"] },
  { key: "draft", label: "Not submitted", statuses: ["draft"] },
  {
    key: "all",
    label: "All",
    statuses: ["pending", "under_review", "approved", "rejected", "suspended", "draft"],
  },
];

export default async function AdminBusinessesPage({ searchParams }: PageProps<"/admin/businesses">) {
  await requireAreaAccess("admin");
  const { status, q } = await searchParams;
  const filter = filters.find((f) => f.key === status) ?? filters[0]!;
  const search = typeof q === "string" ? q.trim().slice(0, 80) : "";

  const supabase = await createClient();
  let query = supabase
    .from("businesses")
    .select(
      "id, name, city, state, status, submitted_at, created_at, primary_category:service_categories(name)",
    )
    .in("status", filter.statuses);
  if (search) query = query.ilike("name", `%${search.replace(/[%_\\]/g, "")}%`);
  const { data, error } = await query
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new AppError("INTERNAL", "Could not load businesses.", { cause: error });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Providers"
        description="Review registrations, and approve, reject, suspend or reactivate providers."
      />
      <FilterTabs
        label="Filter providers"
        current={filter.key}
        tabs={filters.map((f) => ({
          key: f.key,
          label: f.label,
          href: adminHref(`/businesses?status=${f.key}`),
        }))}
      />
      <SearchForm action={adminHref("/businesses")} defaultValue={search} label="Search providers by name">
        <input type="hidden" name="status" value={filter.key} />
      </SearchForm>
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
        <EmptyState
          title={search ? "No providers match your search" : `No ${filter.label.toLowerCase()} providers`}
        />
      )}
      <p className="text-xs text-muted">
        Statuses:{" "}
        {Object.values(businessStatusInfo)
          .map((s) => s.label)
          .join(", ")}
        .
      </p>
    </div>
  );
}
