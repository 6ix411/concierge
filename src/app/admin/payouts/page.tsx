import type { Metadata } from "next";
import Link from "next/link";

import { AdminActionForm } from "@/components/admin/action-form";
import { FormMessage } from "@/components/auth/form-message";
import { FilterTabs, PageHeader, StatCard } from "@/components/admin/dashboard-widgets";
import { Badge, EmptyState } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { doneStatuses } from "@/lib/bookings/rules";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatNaira } from "@/lib/format";
import { refreshPayoutAction, sendAllReadyPayoutsAction, sendPayoutAction } from "@/lib/admin/payout-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const metadata: Metadata = { title: "Payouts" };

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

const filters: { key: string; label: string; statuses: PayoutStatus[] | null }[] = [
  { key: "owed", label: "To pay", statuses: ["pending"] },
  { key: "processing", label: "Processing", statuses: ["processing"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "on_hold", label: "On hold", statuses: ["on_hold"] },
  { key: "withheld", label: "Withheld", statuses: ["failed"] },
  { key: "all", label: "All", statuses: null },
];

const statusInfo: Record<
  PayoutStatus,
  { label: string; tone: "neutral" | "accent" | "verified" | "danger" }
> = {
  pending: { label: "To pay", tone: "accent" },
  processing: { label: "Processing", tone: "accent" },
  paid: { label: "Paid", tone: "verified" },
  on_hold: { label: "On hold (dispute)", tone: "danger" },
  failed: { label: "Withheld", tone: "neutral" },
};

export default async function AdminPayoutsPage({ searchParams }: PageProps<"/admin/payouts">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const filter = filters.find((f) => f.key === params.status) ?? filters[0]!;
  const count = (value: unknown) =>
    typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 0;
  const notices: Record<string, { tone: "success" | "error"; text: string }> = {
    paid: { tone: "success", text: "Payout sent. The money is in the business's account." },
    processing: { tone: "success", text: "Payout sent. The bank is processing it." },
    pending: { tone: "error", text: "The transfer didn't go through. It's back in the list to pay." },
    all: {
      tone: count(params.failed) ? "error" : "success",
      text: `${count(params.sent)} ${count(params.sent) === 1 ? "payout" : "payouts"} sent.${
        count(params.failed) ? ` ${count(params.failed)} didn't go through.` : ""
      }`,
    },
  };
  const notice = typeof params.notice === "string" ? notices[params.notice] : undefined;

  // Admin-only page: reads with the service role after the admin check above.
  const db = createAdminClient();
  let query = db
    .from("payouts")
    .select(
      "id, status, gross_minor, commission_minor, amount_minor, reference, attempts, bank_name, account_number_last4, failure_reason, sent_at, paid_at, created_at, business_id, business:businesses(id, name), booking:bookings(id, reference, status), payment:payments(reference)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter.statuses) query = query.in("status", filter.statuses);
  const [{ data, error }, owed] = await Promise.all([
    query,
    db.from("payouts").select("amount_minor, status").in("status", ["pending", "processing", "on_hold"]),
  ]);
  if (error || owed.error)
    throw new AppError("INTERNAL", "Could not load payouts.", { cause: error ?? owed.error });

  const payouts = data ?? [];
  const { data: accounts } = await db
    .from("business_payout_accounts")
    .select("business_id, bank_name, account_name, account_number")
    .in("business_id", [...new Set(payouts.map((p) => p.business_id))]);
  const accountFor = new Map((accounts ?? []).map((a) => [a.business_id, a]));
  const total = (status: PayoutStatus) =>
    (owed.data ?? []).filter((p) => p.status === status).reduce((sum, p) => sum + p.amount_minor, 0);
  const ready = (payout: (typeof payouts)[number]) =>
    payout.status === "pending" &&
    Boolean(payout.booking && doneStatuses.includes(payout.booking.status)) &&
    accountFor.has(payout.business_id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payouts"
        description="Each business's share of a completed job, after the platform fee, sent to its verified bank account."
        action={
          filter.key === "owed" && payouts.some(ready) ? (
            <AdminActionForm
              action={sendAllReadyPayoutsAction}
              fields={{}}
              label="Pay all ready"
              variant="primary"
            />
          ) : undefined
        }
      />
      {notice && <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="To pay" value={formatNaira(total("pending"))} hint="Jobs completed, not yet sent" />
        <StatCard
          label="Processing"
          value={formatNaira(total("processing"))}
          hint="Sent, waiting on the bank"
        />
        <StatCard label="On hold" value={formatNaira(total("on_hold"))} hint="Held while a dispute is open" />
      </div>
      <FilterTabs
        label="Filter payouts"
        current={filter.key}
        tabs={filters.map((f) => ({
          key: f.key,
          label: f.label,
          href: adminHref(`/payouts?status=${f.key}`),
        }))}
      />
      {payouts.length === 0 ? (
        <EmptyState title="No payouts here" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {payouts.map((payout) => {
            const account = accountFor.get(payout.business_id);
            return (
              <li
                key={payout.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    {payout.business && (
                      <Link
                        href={adminHref(`/businesses/${payout.business.id}`)}
                        className="font-medium hover:underline"
                      >
                        {payout.business.name}
                      </Link>
                    )}
                    <Badge tone={statusInfo[payout.status].tone}>{statusInfo[payout.status].label}</Badge>
                  </span>
                  <span className="text-muted">
                    {payout.booking && (
                      <Link href={adminHref(`/bookings/${payout.booking.id}`)} className="hover:underline">
                        {payout.booking.reference}
                      </Link>
                    )}
                    {payout.payment && ` · paid with ${payout.payment.reference}`}
                    {" · "}
                    {formatNaira(payout.gross_minor)} less {formatNaira(payout.commission_minor)} platform fee
                  </span>
                  <span className="text-muted">
                    {payout.status === "paid" || payout.status === "processing"
                      ? `${payout.bank_name ?? "Bank"} ••${payout.account_number_last4 ?? ""} · ${payout.reference ?? ""}${
                          payout.paid_at
                            ? ` · paid ${formatDateTime(payout.paid_at)}`
                            : payout.sent_at
                              ? ` · sent ${formatDateTime(payout.sent_at)}`
                              : ""
                        }`
                      : account
                        ? `${account.bank_name} ••${account.account_number.slice(-4)} · ${account.account_name}`
                        : "No bank account yet"}
                  </span>
                  {payout.status === "pending" &&
                    payout.booking &&
                    !doneStatuses.includes(payout.booking.status) && (
                      <span className="text-danger">The job isn&apos;t completed.</span>
                    )}
                  {payout.failure_reason && <span className="text-danger">{payout.failure_reason}</span>}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatNaira(payout.amount_minor)}
                  </span>
                  {ready(payout) && (
                    <AdminActionForm
                      action={sendPayoutAction}
                      fields={{ payoutId: payout.id }}
                      label="Pay out"
                    />
                  )}
                  {payout.status === "processing" && (
                    <AdminActionForm
                      action={refreshPayoutAction}
                      fields={{ payoutId: payout.id }}
                      label="Check status"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {payouts.length === 100 && <p className="text-xs text-muted">Showing the latest 100.</p>}
    </div>
  );
}
