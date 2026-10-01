"use server";

import { refresh } from "next/cache";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import type { BookingStatus } from "@/lib/bookings/rules";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { requireOwnBusinessForAction, toFormError } from "./action-utils";
import { businessBookingActions, type BusinessBookingAction } from "./booking-rules";
import { commissionFor } from "./earnings";
import { bookingDecisionSchema, quoteSchema } from "./schemas";

type BookingUpdate = Database["public"]["Tables"]["bookings"]["Update"];

/** The owner's booking (read with their session, so row level security applies). */
async function loadOwnBooking(bookingId: string, businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, reference, status, customer_id, business_id, total_minor, commission_rate_bps, scheduled_start",
    )
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) throw new AppError("NOT_FOUND", "Booking not found.");
  return data;
}

/** Status changes are server-only. Updates only if the status hasn't changed since we checked. */
async function updateIfStatus(
  bookingId: string,
  businessId: string,
  expected: BookingStatus,
  changes: BookingUpdate,
) {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .update(changes)
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .eq("status", expected)
    .select("id");
  if (error) throw new AppError("INTERNAL", "Could not update the booking.", { cause: error });
  if (!data?.length) throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");
}

function assertAllowed(action: BusinessBookingAction, status: BookingStatus) {
  if (!businessBookingActions(status).includes(action))
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
    assertAllowed(action, booking.status);

    if ((action === "decline" || action === "cancel") && !parsed.data.reason)
      return { status: "error", fieldErrors: { reason: "Tell the customer why." } };

    const changes: BookingUpdate = {
      accept: { status: "accepted" },
      decline: { status: "rejected", cancellation_reason: parsed.data.reason ?? null },
      start: { status: "in_progress" },
      complete: { status: "completed" },
      cancel: {
        status: "cancelled",
        cancelled_by: business.owner_id,
        cancellation_reason: parsed.data.reason ?? null,
      },
    }[action] as BookingUpdate;
    await updateIfStatus(booking.id, business.id, booking.status, changes);

    // A completed job creates the business's payout (paid out in the payments stage).
    if (action === "complete") {
      const commission = commissionFor(booking.total_minor, booking.commission_rate_bps);
      const { error } = await createAdminClient()
        .from("payouts")
        .insert({
          business_id: business.id,
          booking_id: booking.id,
          gross_minor: booking.total_minor,
          commission_minor: commission,
          amount_minor: booking.total_minor - commission,
        });
      // 23505: a payout already exists for this booking.
      if (error && error.code !== "23505")
        throw new AppError("INTERNAL", "Booking completed, but the payout wasn't recorded.", {
          cause: error,
        });
    }

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
    assertAllowed("quote", booking.status);

    const admin = createAdminClient();
    const { data: items } = await admin.from("booking_items").select("name").eq("booking_id", booking.id);
    const label = (items ?? []).map((item) => item.name).join(", ");

    await updateIfStatus(booking.id, business.id, booking.status, {
      status: "quoted",
      quote_notes: parsed.data.notes ?? null,
      subtotal_minor: parsed.data.amount,
      platform_fee_minor: 0,
      total_minor: parsed.data.amount,
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
