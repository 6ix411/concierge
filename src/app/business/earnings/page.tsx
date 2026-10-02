import type { Metadata } from "next";
import Link from "next/link";

import { PayoutAccountForm } from "@/components/business/payout-account-form";
import { EmptyState } from "@/components/ui";
import { commissionFor, monthlyEarnings, paidStatuses, summarizeEarnings } from "@/lib/business/earnings";
import { requireOwnBusiness } from "@/lib/business/queries";
import { savePayoutAccountAction } from "@/lib/business/payout-actions";
import { AppError, logger } from "@/lib/errors";
import { formatDate, formatNaira } from "@/lib/format";
import { getPaymentProvider, type Bank } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Earnings" };

const payoutLabels = {
  pending: "Scheduled",
  processing: "On its way",
  paid: "Paid",
  failed: "Failed",
  on_hold: "On hold",
} as const;

function monthName(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, 15)).toLocaleDateString("en-NG", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

export default async function BusinessEarningsPage() {
  const { business } = await requireOwnBusiness();
  const supabase = await createClient();
  const banks = getPaymentProvider()
    .listBanks()
    .catch((error: unknown): Bank[] => {
      logger.error("Could not load the bank list", { error });
      return [];
    });
  const [bookings, payouts, account] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, reference, status, subtotal_minor, commission_rate_bps, completed_at, scheduled_start")
      .eq("business_id", business.id)
      .in("status", paidStatuses)
      .order("scheduled_start", { ascending: false }),
    supabase
      .from("payouts")
      .select(
        "id, status, amount_minor, gross_minor, commission_minor, paid_at, created_at, bank_name, account_number_last4, bookings(reference)",
      )
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("business_payout_accounts")
      .select("bank_name, account_name, account_number, verified_at")
      .eq("business_id", business.id)
      .maybeSingle(),
  ]);
  if (bookings.error || payouts.error)
    throw new AppError("INTERNAL", "Could not load your earnings.", {
      cause: bookings.error ?? payouts.error,
    });

  const summary = summarizeEarnings(bookings.data ?? [], payouts.data ?? []);
  const months = monthlyEarnings(bookings.data ?? [], 6).reverse();

  const cards = [
    { label: "Earned", value: summary.earnedMinor, note: "From completed jobs, after commission" },
    { label: "Upcoming", value: summary.upcomingMinor, note: "Paid jobs not finished yet" },
    { label: "Paid out", value: summary.paidOutMinor, note: "Sent to your bank account" },
    { label: "Awaiting payout", value: summary.awaitingPayoutMinor, note: "Scheduled for your bank account" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Earnings</h1>
        <p className="mt-1 text-muted">
          Customers pay on Concierge. When you mark a job as completed, your share (the price less the
          platform fee) is sent to your bank account.
        </p>
      </div>

      <section
        aria-labelledby="bank-heading"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
      >
        <h2 id="bank-heading" className="text-lg font-semibold">
          Where we pay you
        </h2>
        {!account.data && (
          <p className="text-sm text-muted">Add your bank account so we can send your payouts.</p>
        )}
        {(await banks).length > 0 || account.data ? (
          <PayoutAccountForm action={savePayoutAccountAction} banks={await banks} saved={account.data} />
        ) : (
          <p className="text-sm text-danger">
            We can&apos;t reach our payment provider right now. Try again shortly.
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="text-sm text-muted">{card.label}</span>
            <span className="text-xl font-semibold tracking-tight sm:text-2xl">
              {formatNaira(card.value)}
            </span>
            <span className="text-xs text-muted">{card.note}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="months-heading" className="flex flex-col gap-3">
        <h2 id="months-heading" className="text-lg font-semibold">
          Last 6 months
        </h2>
        <table className="w-full overflow-hidden rounded-2xl border border-border bg-surface text-sm">
          <thead className="sr-only">
            <tr>
              <th>Month</th>
              <th>Earned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {months.map((month) => (
              <tr key={month.month}>
                <td className="p-3">{monthName(month.month)}</td>
                <td className="p-3 text-right font-medium tabular-nums">{formatNaira(month.netMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="paid-heading" className="flex flex-col gap-3">
        <h2 id="paid-heading" className="text-lg font-semibold">
          Paid bookings
        </h2>
        {(bookings.data ?? []).length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-muted">
                <tr className="border-b border-border">
                  <th className="p-3 font-medium">Booking</th>
                  <th className="p-3 text-right font-medium">Paid</th>
                  <th className="p-3 text-right font-medium">Commission</th>
                  <th className="p-3 text-right font-medium">You get</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(bookings.data ?? []).map((booking) => {
                  const commission = commissionFor(booking.subtotal_minor, booking.commission_rate_bps);
                  return (
                    <tr key={booking.id}>
                      <td className="p-3">
                        <Link
                          href={`/business/bookings/${booking.id}`}
                          className="font-medium hover:underline"
                        >
                          {booking.reference}
                        </Link>
                        <span className="block text-xs text-muted">
                          {booking.status === "completed" ? "Completed" : "Not completed yet"}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatNaira(booking.subtotal_minor)}</td>
                      <td className="p-3 text-right text-muted tabular-nums">− {formatNaira(commission)}</td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {formatNaira(booking.subtotal_minor - commission)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No paid bookings yet"
            description="Bookings appear here once the customer has paid."
          />
        )}
      </section>

      <section aria-labelledby="payouts-heading" className="flex flex-col gap-3">
        <h2 id="payouts-heading" className="text-lg font-semibold">
          Payouts
        </h2>
        {(payouts.data ?? []).length > 0 ? (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface text-sm">
            {(payouts.data ?? []).map((payout) => (
              <li key={payout.id} className="flex items-center justify-between gap-3 p-3">
                <span>
                  <span className="font-medium">{payout.bookings?.reference ?? "Payout"}</span>
                  <span className="block text-xs text-muted">
                    {payoutLabels[payout.status]} · {formatDate(payout.paid_at ?? payout.created_at)}
                    {payout.bank_name && ` · ${payout.bank_name} ••${payout.account_number_last4 ?? ""}`}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatNaira(payout.amount_minor)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No payouts yet"
            description="Completed jobs create a payout to your bank account."
          />
        )}
      </section>
    </div>
  );
}
