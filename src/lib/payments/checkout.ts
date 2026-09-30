import "server-only";

import { randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";
import { AppError, logger } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { getPaymentProvider } from "./index";

export function newPaymentReference(): string {
  return `PAY-${randomBytes(8).toString("hex").toUpperCase()}`;
}

/** Creates a pending payment for an accepted booking and returns the provider's checkout URL. */
export async function startPayment(
  booking: { id: string; total_minor: number },
  customer: { id: string; email: string },
) {
  const provider = getPaymentProvider();
  const admin = createAdminClient();
  const reference = newPaymentReference();

  const { error } = await admin.from("payments").insert({
    booking_id: booking.id,
    payer_id: customer.id,
    provider: provider.name,
    reference,
    amount_minor: booking.total_minor,
    status: "pending",
  });
  if (error) throw new AppError("INTERNAL", "Could not start payment.", { cause: error });

  const { authorizationUrl } = await provider.initialize({
    reference,
    amount: { amountMinor: booking.total_minor, currency: "NGN" },
    customerEmail: customer.email,
    callbackUrl: `${getServerEnv().NEXT_PUBLIC_APP_URL}/api/payments/callback`,
    metadata: { bookingId: booking.id },
  });
  return authorizationUrl;
}

/**
 * Verifies a payment with its provider and, if it succeeded for the full amount, confirms the
 * booking (which opens the chat). Safe to call more than once for the same reference.
 */
export async function finalizePayment(reference: string): Promise<{ bookingId: string; paid: boolean }> {
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("id, booking_id, provider, amount_minor, status")
    .eq("reference", reference)
    .maybeSingle();
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  if (payment.status === "success") return { bookingId: payment.booking_id, paid: true };

  const result = await getPaymentProvider(payment.provider).verify(reference);
  const paid = result.status === "success" && result.amount.amountMinor === payment.amount_minor;

  if (!paid) {
    await admin
      .from("payments")
      .update({
        status: result.status === "success" ? "failed" : result.status,
        failure_reason: "Verification failed",
      })
      .eq("id", payment.id)
      .eq("status", "pending");
    return { bookingId: payment.booking_id, paid: false };
  }

  const { error: paymentError } = await admin
    .from("payments")
    .update({ status: "success", paid_at: (result.paidAt ?? new Date()).toISOString() })
    .eq("id", payment.id)
    .eq("status", "pending");
  if (paymentError) throw new AppError("INTERNAL", "Could not record the payment.", { cause: paymentError });

  const { data: confirmed, error: bookingError } = await admin
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", payment.booking_id)
    .eq("status", "accepted")
    .select("id, reference, customer_id, businesses(owner_id)")
    .maybeSingle();
  if (bookingError) logger.error("Paid booking could not be confirmed", { reference, error: bookingError });

  if (confirmed) {
    await notify(
      {
        userId: confirmed.customer_id,
        type: "booking.confirmed",
        title: "Booking confirmed",
        body: `Payment received for ${confirmed.reference}. You can now message the business.`,
        data: { bookingId: confirmed.id },
      },
      ...(confirmed.businesses?.owner_id
        ? [
            {
              userId: confirmed.businesses.owner_id,
              type: "booking.confirmed",
              title: "New confirmed booking",
              body: `${confirmed.reference} has been paid.`,
              data: { bookingId: confirmed.id },
            },
          ]
        : []),
    );
  }
  return { bookingId: payment.booking_id, paid: true };
}
