import { doneStatuses, paidStatuses, type BookingStatus } from "@/lib/bookings/rules";
import type { Database } from "@/types/database";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/** The platform's share of a booking, in kobo (rounded to the nearest kobo). */
export function commissionFor(totalMinor: number, rateBps: number): number {
  return Math.round((totalMinor * rateBps) / 10_000);
}

export { paidStatuses };

export type EarningsBooking = {
  status: BookingStatus;
  total_minor: number;
  commission_rate_bps: number;
  completed_at: string | null;
};

export type EarningsPayout = { status: PayoutStatus; amount_minor: number };

export type EarningsSummary = {
  /** Paid by customers across all paid bookings. */
  grossMinor: number;
  commissionMinor: number;
  /** What the business keeps after commission. */
  netMinor: number;
  /** Net for completed jobs. */
  earnedMinor: number;
  /** Net for paid jobs that aren't finished yet; released once the job is completed. */
  upcomingMinor: number;
  paidOutMinor: number;
  awaitingPayoutMinor: number;
  paidBookingCount: number;
};

export function summarizeEarnings(bookings: EarningsBooking[], payouts: EarningsPayout[]): EarningsSummary {
  const summary: EarningsSummary = {
    grossMinor: 0,
    commissionMinor: 0,
    netMinor: 0,
    earnedMinor: 0,
    upcomingMinor: 0,
    paidOutMinor: 0,
    awaitingPayoutMinor: 0,
    paidBookingCount: 0,
  };
  for (const booking of bookings) {
    if (!paidStatuses.includes(booking.status)) continue;
    const commission = commissionFor(booking.total_minor, booking.commission_rate_bps);
    const net = booking.total_minor - commission;
    summary.paidBookingCount += 1;
    summary.grossMinor += booking.total_minor;
    summary.commissionMinor += commission;
    summary.netMinor += net;
    if (doneStatuses.includes(booking.status)) summary.earnedMinor += net;
    else if (booking.status === "confirmed" || booking.status === "in_progress") summary.upcomingMinor += net;
  }
  for (const payout of payouts) {
    if (payout.status === "paid") summary.paidOutMinor += payout.amount_minor;
    else if (payout.status !== "failed") summary.awaitingPayoutMinor += payout.amount_minor;
  }
  return summary;
}

/** Net earnings from completed jobs per month (YYYY-MM, Lagos time), oldest first, for the last `months` months. */
export function monthlyEarnings(
  bookings: EarningsBooking[],
  months: number,
  now = new Date(),
): { month: string; netMinor: number }[] {
  const lagos = (date: Date) => new Date(date.getTime() + 60 * 60 * 1000); // UTC+01:00, no DST
  const current = lagos(now);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const totals = new Map(keys.map((key) => [key, 0]));
  for (const booking of bookings) {
    if (!doneStatuses.includes(booking.status) || !booking.completed_at) continue;
    const key = lagos(new Date(booking.completed_at)).toISOString().slice(0, 7);
    if (!totals.has(key)) continue;
    const net = booking.total_minor - commissionFor(booking.total_minor, booking.commission_rate_bps);
    totals.set(key, (totals.get(key) ?? 0) + net);
  }
  return keys.map((month) => ({ month, netMinor: totals.get(month) ?? 0 }));
}
