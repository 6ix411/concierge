import "server-only";

import { randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";
import { AppError, logger } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { logSecurityEvent } from "@/lib/security/events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { getPaymentProvider } from "./index";

export function newPaymentReference(): string {
  return `PAY-${randomBytes(8).toString("hex").toUpperCase()}`;
}

/**
 * Creates a pending payment for a booking awaiting payment and returns the provider's checkout URL.
 * The database works out the business, commission and the business's share from the booking.
 */
export async function startPayment(
  booking: { id: string; total_minor: number; business_id: string; commission_rate_bps: number },
  customer: { id: string; email: string },
) {
  const provider = getPaymentProvider();
  const admin = createAdminClient();
  const reference = newPaymentReference();

  const { error } = await admin.from("payments").insert({
    booking_id: booking.id,
    payer_id: customer.id,
    business_id: booking.business_id,
    commission_rate_bps: booking.commission_rate_bps,
    provider: provider.name,
    reference,
    amount_minor: booking.total_minor,
    status: "pending",
  });
  if (error) throw new AppError("INTERNAL", "Could not start payment.", { cause: error });

  try {
    const { authorizationUrl } = await provider.initialize({
      reference,
      amount: { amountMinor: booking.total_minor, currency: "NGN" },
      customerEmail: customer.email,
      callbackUrl: `${getServerEnv().NEXT_PUBLIC_APP_URL}/api/payments/callback`,
      metadata: { bookingId: booking.id },
    });
    return authorizationUrl;
  } catch (cause) {
    await admin
      .from("payments")
      .update({ status: "failed", failure_reason: "Checkout could not be started" })
      .eq("reference", reference)
      .eq("status", "pending");
    throw cause;
  }
}

/**
 * Verifies a payment with its provider, server to server, and only then marks it successful and
 * confirms the booking (which opens the chat). Nothing the browser or a webhook says is trusted on
 * its own. Safe to call more than once for the same reference.
 */
export async function finalizePayment(
  reference: string,
  source: "callback" | "webhook" = "callback",
  expectedProvider?: string,
): Promise<{ bookingId: string; paid: boolean }> {
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("id, booking_id, provider, amount_minor, status")
    .eq("reference", reference)
    .maybeSingle();
  if (!payment || (expectedProvider && payment.provider !== expectedProvider))
    throw new AppError("NOT_FOUND", "Payment not found.");
  if (payment.status === "success") return { bookingId: payment.booking_id, paid: true };

  const result = await getPaymentProvider(payment.provider).verify(reference);
  const paid =
    result.status === "success" &&
    result.amount.currency === "NGN" &&
    result.amount.amountMinor === payment.amount_minor;
  const evidence = {
    verifiedVia: source,
    verifiedAt: new Date().toISOString(),
    providerStatus: result.status,
    providerAmountMinor: result.amount.amountMinor,
  } satisfies Json;

  if (!paid) {
    // Still pending at the provider: leave it for the webhook or a retry.
    if (result.status === "pending") return { bookingId: payment.booking_id, paid: false };
    if (result.status === "success")
      await logSecurityEvent("payment.mismatch", {
        details: {
          reference,
          expectedMinor: payment.amount_minor,
          paidMinor: result.amount.amountMinor,
          currency: result.amount.currency,
        },
      });
    await admin
      .from("payments")
      .update({
        status: result.status === "success" ? "failed" : result.status,
        failure_reason:
          result.status === "success" ? "Amount or currency didn't match the booking" : "Not completed",
        provider_reference: result.providerReference,
        provider_payload: evidence,
      })
      .eq("id", payment.id)
      .eq("status", "pending");
    return { bookingId: payment.booking_id, paid: false };
  }

  const { data: recorded, error: paymentError } = await admin
    .from("payments")
    .update({
      status: "success",
      paid_at: (result.paidAt ?? new Date()).toISOString(),
      provider_reference: result.providerReference,
      channel: result.channel,
      provider_payload: evidence,
    })
    .eq("id", payment.id)
    .in("status", ["pending", "failed", "abandoned"])
    .select("id");
  if (paymentError) throw new AppError("INTERNAL", "Could not record the payment.", { cause: paymentError });
  // The callback and the webhook can arrive together: only the one that recorded the payment goes on.
  if (!recorded?.length) return { bookingId: payment.booking_id, paid: true };

  const { data: confirmed, error: bookingError } = await admin
    .from("bookings")
    .update({ status: "confirmed", change_note: `Payment ${reference} verified` })
    .eq("id", payment.booking_id)
    .eq("status", "payment_pending")
    .select("id, reference, customer_id, businesses(owner_id)")
    .maybeSingle();
  if (bookingError || !confirmed) {
    // Paid, but the booking moved on (for example it was cancelled). It shows up as a refund due.
    logger.error("Paid booking could not be confirmed", { reference, error: bookingError });
  }

  if (confirmed) {
    await notify(
      {
        userId: confirmed.customer_id,
        type: "payment.confirmed",
        title: `Payment received: ${confirmed.reference}`,
        body: "Your booking is confirmed. You can now message the business.",
        data: { bookingId: confirmed.id },
      },
      ...(confirmed.businesses?.owner_id
        ? [
            {
              userId: confirmed.businesses.owner_id,
              type: "payment.confirmed",
              title: `Booking paid: ${confirmed.reference}`,
              body: "The customer has paid. The booking is confirmed.",
              data: { bookingId: confirmed.id },
            },
          ]
        : []),
    );
  }
  return { bookingId: payment.booking_id, paid: true };
}
