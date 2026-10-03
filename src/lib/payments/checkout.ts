import "server-only";

import { randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";
import { AppError, logger } from "@/lib/errors";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { logSecurityEvent } from "@/lib/security/events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { getPaymentProvider } from "./index";
import { refundPayment } from "./refunds";

const OPEN_CHECKOUT_MS = 30 * 60_000;

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

  // A checkout opened in the last half hour is still open: send the customer back to it rather
  // than starting a second charge (two tabs, a double tap, or coming back from the provider).
  const { data: open } = await admin
    .from("payments")
    .select("checkout_url")
    .eq("booking_id", booking.id)
    .eq("payer_id", customer.id)
    .eq("provider", provider.name)
    .eq("status", "pending")
    .eq("amount_minor", booking.total_minor)
    .not("checkout_url", "is", null)
    .gte("created_at", new Date(Date.now() - OPEN_CHECKOUT_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open?.checkout_url) return open.checkout_url;

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
    await admin.from("payments").update({ checkout_url: authorizationUrl }).eq("reference", reference);
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

  // Someone already paid for this booking (two tabs, or a retry after a lost reply): this payment is
  // recorded as a duplicate and given straight back.
  const { count: alreadyPaid } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", payment.booking_id)
    .neq("id", payment.id)
    .eq("duplicate", false)
    .in("status", ["success", "partially_refunded", "refunded"]);
  const record = (duplicate: boolean) =>
    admin
      .from("payments")
      .update({
        status: "success",
        duplicate,
        paid_at: (result.paidAt ?? new Date()).toISOString(),
        provider_reference: result.providerReference,
        channel: result.channel,
        provider_payload: evidence,
      })
      .eq("id", payment.id)
      .in("status", ["pending", "failed", "abandoned"])
      .select("id");
  let duplicate = (alreadyPaid ?? 0) > 0;
  let { data: recorded, error: paymentError } = await record(duplicate);
  // Both payments were verified at the same moment and the other one was recorded first.
  if (paymentError?.code === "23505" && !duplicate) {
    duplicate = true;
    ({ data: recorded, error: paymentError } = await record(true));
  }
  if (paymentError) throw new AppError("INTERNAL", "Could not record the payment.", { cause: paymentError });
  // The callback and the webhook can arrive together: only the one that recorded the payment goes on.
  if (!recorded?.length) return { bookingId: payment.booking_id, paid: true };
  if (duplicate) {
    await refundDuplicatePayment(reference, payment.booking_id);
    return { bookingId: payment.booking_id, paid: true };
  }

  const { data: confirmed, error: bookingError } = await admin
    .from("bookings")
    .update({ status: "confirmed", change_note: `Payment ${reference} verified` })
    .eq("id", payment.booking_id)
    .eq("status", "payment_pending")
    .select("id, reference, customer_id, businesses(owner_id)")
    .maybeSingle();
  // Paid, but the booking moved on (for example it was cancelled). It shows up as a refund due.
  if (bookingError || !confirmed)
    logger.error("Paid booking could not be confirmed", { reference, error: bookingError });

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

/** Refunds a second successful payment for a booking that was already paid, and tells the customer. */
async function refundDuplicatePayment(reference: string, bookingId: string) {
  const admin = createAdminClient();
  const { data: duplicate } = await admin
    .from("payments")
    .select(
      "id, reference, provider, provider_reference, amount_minor, refunded_minor, status, refund_status, payer_id",
    )
    .eq("reference", reference)
    .single();
  await logSecurityEvent("payment.duplicate", { details: { reference, bookingId } });
  if (!duplicate) return;
  try {
    await refundPayment(duplicate);
    await notify({
      userId: duplicate.payer_id,
      type: "booking.refunded",
      title: "Duplicate payment refunded",
      body: `This booking was already paid, so we’re sending back ${formatNaira(duplicate.amount_minor)}. Banks can take a few working days.`,
      data: { bookingId },
    });
  } catch (error) {
    // Left for an admin: the payment shows as paid with nothing to confirm.
    logger.error("Could not refund a duplicate payment", { reference, error });
  }
}
