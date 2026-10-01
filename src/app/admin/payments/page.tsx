import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader, StatCard } from "@/components/admin/dashboard-widgets";
import { SearchForm } from "@/components/admin/search-form";
import { Badge, EmptyState } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const metadata: Metadata = { title: "Payments" };

type PaymentStatus = Database["public"]["Enums"]["payment_status"];

const filters: { key: string; label: string; statuses: PaymentStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "success", label: "Successful", statuses: ["success"] },
  { key: "pending", label: "Pending", statuses: ["pending"] },
  { key: "failed", label: "Failed", statuses: ["failed", "abandoned"] },
  { key: "refunded", label: "Refunded", statuses: ["refunded", "partially_refunded"] },
];

const statusInfo: Record<
  PaymentStatus,
  { label: string; tone: "neutral" | "accent" | "verified" | "danger" }
> = {
  pending: { label: "Pending", tone: "accent" },
  success: { label: "Successful", tone: "verified" },
  failed: { label: "Failed", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
  partially_refunded: { label: "Part refunded", tone: "neutral" },
};

export default async function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const filter = filters.find((f) => f.key === params.status) ?? filters[0]!;
  const search =
    typeof params.q === "string"
      ? params.q
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, "")
          .slice(0, 40)
      : "";

  // Admin-only page: reads with the service role after the admin check above.
  const db = createAdminClient();
  let query = db
    .from("payments")
    .select(
      "id, reference, provider_reference, provider, channel, amount_minor, currency, platform_fee_minor, provider_amount_minor, status, refund_status, paid_at, created_at, booking:bookings(id, reference), business:businesses(id, name), customer:users!payments_payer_id_fkey(id, full_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter.statuses) query = query.in("status", filter.statuses);
  if (search) query = query.ilike("reference", `%${search}%`);
  const [{ data, error }, totals] = await Promise.all([
    query,
    db
      .from("payments")
      .select("amount_minor, platform_fee_minor, provider_amount_minor")
      .eq("status", "success"),
  ]);
  if (error || totals.error)
    throw new AppError("INTERNAL", "Could not load payments.", { cause: error ?? totals.error });

  const sum = (key: "amount_minor" | "platform_fee_minor" | "provider_amount_minor") =>
    (totals.data ?? []).reduce((total, p) => total + p[key], 0);
  const payments = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Every payment customers have made. Only payments verified with the payment provider count as successful."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Collected"
          value={formatNaira(sum("amount_minor"))}
          hint="Successful payments, not refunded"
        />
        <StatCard
          label="Platform fees"
          value={formatNaira(sum("platform_fee_minor"))}
          hint="Commission kept by Concierge"
        />
        <StatCard
          label="Owed to businesses"
          value={formatNaira(sum("provider_amount_minor"))}
          hint="Paid out after each job"
          href={adminHref("/payouts")}
        />
      </div>
      <FilterTabs
        label="Filter payments"
        current={filter.key}
        tabs={filters.map((f) => ({
          key: f.key,
          label: f.label,
          href: adminHref(`/payments?status=${f.key}`),
        }))}
      />
      <SearchForm
        action={adminHref("/payments")}
        defaultValue={search}
        label="Search by payment reference"
        placeholder="Reference, e.g. PAY-3F9A…"
      />
      {payments.length === 0 ? (
        <EmptyState title="No payments here" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-border">
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Reference</th>
                <th className="p-3 font-medium">Booking</th>
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">Business</th>
                <th className="p-3 text-right font-medium">Amount</th>
                <th className="p-3 text-right font-medium">Platform fee</th>
                <th className="p-3 text-right font-medium">Business gets</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map((payment) => (
                <tr key={payment.id} className="align-top">
                  <td className="p-3 whitespace-nowrap">
                    {formatDateTime(payment.paid_at ?? payment.created_at)}
                  </td>
                  <td className="p-3">
                    <span className="font-mono text-xs">{payment.reference}</span>
                    <span className="block text-xs text-muted">
                      {payment.provider}
                      {payment.channel && ` · ${payment.channel}`}
                      {payment.provider_reference && ` · ${payment.provider_reference}`}
                    </span>
                  </td>
                  <td className="p-3">
                    {payment.booking && (
                      <Link
                        href={adminHref(`/bookings/${payment.booking.id}`)}
                        className="font-medium hover:underline"
                      >
                        {payment.booking.reference}
                      </Link>
                    )}
                  </td>
                  <td className="p-3">
                    {payment.customer && (
                      <Link href={adminHref(`/users/${payment.customer.id}`)} className="hover:underline">
                        {payment.customer.full_name ?? payment.customer.email}
                      </Link>
                    )}
                  </td>
                  <td className="p-3">
                    {payment.business && (
                      <Link
                        href={adminHref(`/businesses/${payment.business.id}`)}
                        className="hover:underline"
                      >
                        {payment.business.name}
                      </Link>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap tabular-nums">
                    {formatNaira(payment.amount_minor)}
                    <span className="block text-xs text-muted">{payment.currency}</span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap tabular-nums">
                    {formatNaira(payment.platform_fee_minor)}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap tabular-nums">
                    {formatNaira(payment.provider_amount_minor)}
                  </td>
                  <td className="p-3">
                    <Badge tone={statusInfo[payment.status].tone}>{statusInfo[payment.status].label}</Badge>
                    {payment.refund_status === "pending" && (
                      <span className="block text-xs text-muted">Refund on its way</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payments.length === 100 && <p className="text-xs text-muted">Showing the latest 100.</p>}
    </div>
  );
}
