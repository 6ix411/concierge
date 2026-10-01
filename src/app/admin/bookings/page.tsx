import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { SearchForm } from "@/components/admin/search-form";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { EmptyState } from "@/components/ui";
import { activeBookingStatuses } from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import type { BookingStatus } from "@/lib/bookings/rules";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Bookings" };

const filters: { key: string; label: string; statuses: BookingStatus[] | null }[] = [
  { key: "active", label: "Active", statuses: activeBookingStatuses },
  { key: "requests", label: "Waiting on business", statuses: ["requested", "pending_provider"] },
  { key: "unpaid", label: "Waiting on payment", statuses: ["quoted", "accepted", "payment_pending"] },
  { key: "upcoming", label: "Paid", statuses: ["confirmed", "in_progress"] },
  { key: "disputed", label: "Disputed", statuses: ["disputed"] },
  { key: "completed", label: "Completed", statuses: ["completed", "reviewed"] },
  { key: "refunds", label: "Refunds due", statuses: ["cancelled"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled", "declined", "expired"] },
  { key: "refunded", label: "Refunded", statuses: ["refunded"] },
  { key: "all", label: "All", statuses: null },
];

export default async function AdminBookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const filter = filters.find((f) => f.key === params.status) ?? filters[0]!;
  const search = typeof params.q === "string" ? params.q.trim().toUpperCase().slice(0, 40) : "";
  const businessId = z.guid().safeParse(params.business).data;
  const customerId = z.guid().safeParse(params.customer).data;

  // Admin-only page: reads with the service role after the admin check above.
  const db = createAdminClient();
  let query = db
    .from("bookings")
    .select(
      "id, reference, status, scheduled_start, total_minor, created_at, business:businesses(id, name), customer:users!bookings_customer_id_fkey(id, full_name, email), payments(status)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter.statuses) query = query.in("status", filter.statuses);
  if (search) query = query.ilike("reference", `%${search.replace(/[^A-Z0-9-]/g, "")}%`);
  if (businessId) query = query.eq("business_id", businessId);
  if (customerId) query = query.eq("customer_id", customerId);
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load bookings.", { cause: error });

  const scope = [businessId && `business=${businessId}`, customerId && `customer=${customerId}`]
    .filter(Boolean)
    .join("&");
  const hrefFor = (key: string) => adminHref(`/bookings?status=${key}${scope ? `&${scope}` : ""}`);
  // Refunds due: cancelled bookings that still hold a successful payment.
  const bookings = (data ?? []).filter(
    (booking) =>
      filter.key !== "refunds" ||
      booking.payments.some((p) => p.status === "success" || p.status === "partially_refunded"),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bookings" description="Every booking on the marketplace. Open one to manage it." />
      <FilterTabs
        label="Filter bookings"
        current={filter.key}
        tabs={filters.map((f) => ({ key: f.key, label: f.label, href: hrefFor(f.key) }))}
      />
      <SearchForm
        action={adminHref("/bookings")}
        defaultValue={search}
        label="Search by booking reference"
        placeholder="Reference, e.g. BK-4F2A"
      >
        <input type="hidden" name="status" value="all" />
      </SearchForm>
      {(businessId || customerId) && (
        <p className="text-sm text-muted">
          Showing one {businessId ? "business" : "customer"}’s bookings.{" "}
          <Link href={adminHref(`/bookings?status=${filter.key}`)} className="font-medium hover:underline">
            Show everyone’s
          </Link>
        </p>
      )}
      {bookings.length === 0 ? (
        <EmptyState title="No bookings here" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link
                href={adminHref(`/bookings/${booking.id}`)}
                className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {booking.business?.name}{" "}
                    <span className="font-normal text-muted">· {booking.reference}</span>
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {booking.customer?.full_name ?? booking.customer?.email}
                    {booking.scheduled_start && ` · ${formatDateTime(booking.scheduled_start)}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <BookingStatusBadge status={booking.status} />
                  <span className="text-sm tabular-nums">
                    {booking.total_minor > 0 ? formatNaira(booking.total_minor) : "Quote"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {bookings.length === 100 && <p className="text-xs text-muted">Showing the latest 100.</p>}
    </div>
  );
}
