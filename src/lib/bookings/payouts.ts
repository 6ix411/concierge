import "server-only";

import { commissionFor } from "@/lib/business/earnings";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records what the business is owed for a completed booking: the service price minus the platform's
 * commission. The customer's booking fee belongs to the platform and is not part of the payout.
 * Safe to call twice: a booking only ever has one payout. An admin sends it to the business's bank account (src/lib/payments/payouts.ts).
 */
export async function recordPayout(booking: {
  id: string;
  business_id: string;
  total_minor: number;
  commission_rate_bps: number;
}): Promise<void> {
  const db = createAdminClient();
  // A payout held during a dispute is released rather than duplicated.
  const { data: held } = await db
    .from("payouts")
    .update({ status: "pending" })
    .eq("booking_id", booking.id)
    .eq("status", "on_hold")
    .select("id");
  if (held?.length) return;

  // The split recorded on the customer's payment decides the payout; older bookings fall back to the booking's rate.
  const { data: payment } = await db
    .from("payments")
    .select("id, amount_minor, platform_fee_minor, provider_amount_minor, booking_fee_minor")
    .eq("booking_id", booking.id)
    .eq("status", "success")
    .eq("duplicate", false)
    .maybeSingle();
  const fee = payment?.booking_fee_minor ?? 0;
  const gross = payment ? payment.amount_minor - fee : booking.total_minor;
  const commission = payment
    ? payment.platform_fee_minor - fee
    : commissionFor(booking.total_minor, booking.commission_rate_bps);
  const { error } = await db.from("payouts").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    payment_id: payment?.id ?? null,
    gross_minor: gross,
    commission_minor: commission,
    amount_minor: payment?.provider_amount_minor ?? gross - commission,
  });
  // 23505: a payout already exists for this booking.
  if (error && error.code !== "23505")
    throw new AppError("INTERNAL", "Booking completed, but the payout wasn't recorded.", { cause: error });
}

/** Holds the payout while a dispute is open, so nothing is paid out before it's settled. */
export async function holdPayout(bookingId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("payouts")
    .update({ status: "on_hold" })
    .eq("booking_id", bookingId)
    .in("status", ["pending", "processing"]);
  if (error) throw new AppError("INTERNAL", "Could not hold the payout.", { cause: error });
}

/** Withholds the payout when the customer is refunded. */
export async function withholdPayout(bookingId: string, reason: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("payouts")
    .update({ status: "failed", failure_reason: reason })
    .eq("booking_id", bookingId)
    .in("status", ["pending", "processing", "on_hold"]);
  if (error) throw new AppError("INTERNAL", "Could not withhold the payout.", { cause: error });
}
