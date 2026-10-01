import "server-only";

import { moveBooking } from "@/lib/bookings/transitions";
import { AppError, logger } from "@/lib/errors";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { getPaymentProvider } from "./index";

type RefundablePayment = {
  id: string;
  reference: string;
  provider: "paystack" | "flutterwave" | "mock";
  provider_reference: string | null;
  amount_minor: number;
  refunded_minor: number;
  status: string;
  refund_status: string | null;
};

/**
 * Asks the payment provider to send the money back to the customer. Returns "processed" when the
 * provider has already refunded it, or "pending" when it will confirm later by webhook.
 */
export async function refundPayment(payment: RefundablePayment): Promise<"processed" | "pending"> {
  if (payment.refund_status === "pending") return "pending";
  const remaining = payment.amount_minor - payment.refunded_minor;
  if (remaining <= 0 || (payment.status !== "success" && payment.status !== "partially_refunded"))
    throw new AppError("CONFLICT", "There's nothing left to refund on this payment.");

  const result = await getPaymentProvider(payment.provider).refund({
    reference: payment.reference,
    providerReference: payment.provider_reference,
    amount: { amountMinor: remaining, currency: "NGN" },
  });
  if (result.status === "failed")
    throw new AppError(
      "CONFLICT",
      "The payment provider declined the refund. Try again or refund it from their dashboard.",
    );

  const db = createAdminClient();
  const { error } = await db
    .from("payments")
    .update(
      result.status === "processed"
        ? {
            status: "refunded",
            refunded_minor: payment.amount_minor,
            refund_status: "processed",
            refund_reference: result.providerReference,
            refunded_at: new Date().toISOString(),
          }
        : { refund_status: "pending", refund_reference: result.providerReference },
    )
    .eq("id", payment.id);
  if (error) throw new AppError("INTERNAL", "The refund was sent but not recorded.", { cause: error });
  return result.status;
}

/**
 * A provider told us (by signed webhook) how a refund ended. Marks the payment and, once nothing is
 * left to refund, moves the cancelled booking to refunded and tells the customer.
 */
export async function completeRefund(
  paymentReference: string,
  status: "processed" | "failed",
): Promise<void> {
  const db = createAdminClient();
  const { data: payment } = await db
    .from("payments")
    .select("id, booking_id, amount_minor, status, refund_status")
    .eq("reference", paymentReference)
    .maybeSingle();
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  if (payment.status === "refunded") return;

  if (status === "failed") {
    await db.from("payments").update({ refund_status: "failed" }).eq("id", payment.id);
    logger.error("Refund failed at the payment provider", { reference: paymentReference });
    return;
  }

  const { error } = await db
    .from("payments")
    .update({
      status: "refunded",
      refunded_minor: payment.amount_minor,
      refund_status: "processed",
      refunded_at: new Date().toISOString(),
    })
    .eq("id", payment.id);
  if (error) throw new AppError("INTERNAL", "Could not record the refund.", { cause: error });
  await markBookingRefunded(payment.booking_id, null);
}

/** Moves a cancelled booking to refunded once none of its payments still holds money. */
export async function markBookingRefunded(bookingId: string, actorId: string | null): Promise<boolean> {
  const db = createAdminClient();
  const { data: booking } = await db
    .from("bookings")
    .select("id, reference, status, customer_id, payments(status, amount_minor, refunded_minor)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.status !== "cancelled") return false;
  const stillHeld = booking.payments.some((p) => p.status === "success" || p.status === "partially_refunded");
  if (stillHeld) return false;
  const refunded = booking.payments
    .filter((p) => p.status === "refunded")
    .reduce((sum, p) => sum + p.refunded_minor, 0);

  await moveBooking({
    bookingId: booking.id,
    from: "cancelled",
    to: "refunded",
    actorId,
    note: `${formatNaira(refunded)} refunded to the customer`,
  });
  await notify({
    userId: booking.customer_id,
    type: "booking.refunded",
    title: "Refund sent",
    body: `${formatNaira(refunded)} for ${booking.reference} has been refunded to you.`,
    data: { bookingId: booking.id },
  });
  return true;
}
