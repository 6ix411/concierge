"use server";

import { refresh } from "next/cache";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { recordPayout } from "@/lib/bookings/payouts";
import { bookingFeeFor, type BookingStatus } from "@/lib/bookings/rules";
import { moveBooking } from "@/lib/bookings/transitions";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { getBookingFeeRule } from "@/lib/revenue/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { requireOwnBusinessForAction, toFormError } from "./action-utils";
import { businessBookingActions, type BusinessBookingAction } from "./booking-rules";
import { bookingDecisionSchema, quoteSchema } from "./schemas";

/** The owner's booking (read with their session, so row level security applies). */
async function loadOwnBooking(bookingId: string, businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, reference, status, needs_quote, customer_id, business_id, total_minor, commission_rate_bps, scheduled_start",
    )
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Booking not found.");
  return data;
}

function assertAllowed(
  action: BusinessBookingAction,
  booking: { status: BookingStatus; needs_quote: boolean },
) {
  if (!businessBookingActions(booking.status, booking.needs_quote).includes(action))
    throw new AppError(
      "CONFLICT",
      "That isn't possible for this booking any more. Refresh to see the latest.",
    );
}

const customerMessages: Record<
  Exclude<BusinessBookingAction, "quote">,
  { type: string; title: string; body: (ref: string) => string }
> = {
  accept: {
    type: "booking.accepted",
    title: "Booking accepted",
    body: (ref) => `${ref} was accepted. Pay to confirm your booking.`,
  },
  decline: {
    type: "booking.declined",
    title: "Booking declined",
    body: (ref) => `The business can't take ${ref}. Try another provider.`,
  },
  start: { type: "booking.started", title: "Job started", body: (ref) => `Work on ${ref} has started.` },
  complete: {
    type: "booking.completed",
    title: "Job completed",
    body: (ref) => `${ref} is complete. Leave a review to help others.`,
  },
  cancel: {
    type: "booking.cancelled",
    title: "Booking cancelled by the business",
    body: (ref) => `The business cancelled ${ref}. Our team will be in touch about any payment.`,
  },
};

/** Accept, decline, start, complete or cancel a booking as the business. */
export async function updateBookingStatusAction(
  action: Exclude<BusinessBookingAction, "quote">,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = bookingDecisionSchema.safeParse({
      bookingId: formData.get("bookingId"),
      reason: formData.get("reason") || undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const booking = await loadOwnBooking(parsed.data.bookingId, business.id);
    assertAllowed(action, booking);

    if ((action === "decline" || action === "cancel") && !parsed.data.reason)
      return { status: "error", fieldErrors: { reason: "Tell the customer why." } };

    const reason = parsed.data.reason ?? null;
    const moves = {
      accept: { to: "accepted", changes: {} },
      decline: { to: "declined", changes: { cancellation_reason: reason } },
      start: { to: "in_progress", changes: {} },
      complete: { to: "completed", changes: {} },
      cancel: { to: "cancelled", changes: { cancelled_by: business.owner_id, cancellation_reason: reason } },
    } satisfies Record<typeof action, { to: BookingStatus; changes: object }>;
    await moveBooking({
      bookingId: booking.id,
      from: booking.status,
      to: moves[action].to,
      actorId: business.owner_id,
      changes: moves[action].changes,
      scope: { businessId: business.id },
    });

    // A completed job creates the business's payout (paid out in the payments stage).
    if (action === "complete") await recordPayout(booking);

    const message = customerMessages[action];
    await notify({
      userId: booking.customer_id,
      type: message.type,
      title: message.title,
      body: message.body(booking.reference),
      data: { bookingId: booking.id },
    });
  } catch (error) {
    return toFormError(error, "We couldn't update the booking. Please try again.");
  }
  refresh();
  return { status: "success", message: "Booking updated." };
}

/** Reply to a quote request with a price. The customer then accepts and pays. */
export async function sendQuoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = quoteSchema.safeParse({
      bookingId: formData.get("bookingId"),
      amount: formData.get("amount"),
      notes: formData.get("notes") || undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const booking = await loadOwnBooking(parsed.data.bookingId, business.id);
    assertAllowed("quote", booking);

    const admin = createAdminClient();
    const { data: items } = await admin.from("booking_items").select("name").eq("booking_id", booking.id);
    const label = (items ?? []).map((item) => item.name).join(", ");
    // The customer's booking fee (if an admin has set one) is added on top of the quoted price.
    const fee = bookingFeeFor(parsed.data.amount, await getBookingFeeRule());

    await moveBooking({
      bookingId: booking.id,
      from: booking.status,
      to: "quoted",
      actorId: business.owner_id,
      note: parsed.data.notes ?? null,
      changes: {
        quote_notes: parsed.data.notes ?? null,
        subtotal_minor: parsed.data.amount,
        platform_fee_minor: fee,
        total_minor: parsed.data.amount + fee,
      },
      scope: { businessId: business.id },
    });
    // The quote replaces the estimate: one line for the quoted price.
    await admin.from("booking_items").delete().eq("booking_id", booking.id);
    await admin.from("booking_items").insert({
      booking_id: booking.id,
      name: label ? `Quote: ${label}`.slice(0, 200) : "Quoted price",
      unit_price_minor: parsed.data.amount,
      quantity: 1,
    });

    await notify({
      userId: booking.customer_id,
      type: "booking.quoted",
      title: "You have a quote",
      body: `${business.name} sent a price for ${booking.reference}.`,
      data: { bookingId: booking.id },
    });
  } catch (error) {
    return toFormError(error, "We couldn't send the quote. Please try again.");
  }
  refresh();
  return { status: "success", message: "Quote sent." };
}
