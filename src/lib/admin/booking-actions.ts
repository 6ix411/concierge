"use server";

import { refresh } from "next/cache";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { recordPayout, withholdPayout } from "@/lib/bookings/payouts";
import { moveBooking } from "@/lib/bookings/transitions";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { adminBookingActions, amountPaid, type AdminBookingAction } from "./rules";
import { bookingAdminSchema } from "./schemas";

/** Complete, cancel or record a refund for a booking on behalf of the platform. Logged, and both sides are notified. */
export async function adminBookingAction(
  action: AdminBookingAction,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let message = "Booking updated.";
  try {
    const admin = await requireRole("admin");
    const parsed = bookingAdminSchema.safeParse({
      bookingId: formData.get("bookingId"),
      reason: formData.get("reason") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { bookingId, reason } = parsed.data;
    if (action === "cancel" && !reason)
      return { status: "error", fieldErrors: { reason: "Give a reason. Both sides will see it." } };

    const db = createAdminClient();
    const { data: booking } = await db
      .from("bookings")
      .select(
        "id, reference, status, customer_id, business_id, total_minor, commission_rate_bps, businesses(owner_id), payments(id, status, amount_minor, refunded_minor)",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) throw new AppError("NOT_FOUND", "Booking not found.");
    const rule = adminBookingActions[action];
    if (!rule.from.includes(booking.status))
      throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");

    const paid = amountPaid(booking.payments);
    if (action === "refund") {
      if (paid <= 0) throw new AppError("CONFLICT", "There's nothing left to refund on this booking.");
      // The refund is sent from the payment provider's dashboard; this records that it was made.
      for (const payment of booking.payments) {
        if (payment.status !== "success" && payment.status !== "partially_refunded") continue;
        const { error: refundError } = await db
          .from("payments")
          .update({ status: "refunded", refunded_minor: payment.amount_minor })
          .eq("id", payment.id);
        if (refundError)
          throw new AppError("INTERNAL", "Could not record the refund.", { cause: refundError });
      }
    }

    await moveBooking({
      bookingId: booking.id,
      from: booking.status,
      to: rule.to,
      actorId: admin.id,
      note: action === "refund" ? `${formatNaira(paid)} refunded${reason ? `: ${reason}` : ""}` : null,
      changes:
        action === "cancel" ? { cancelled_by: admin.id, cancellation_reason: reason ?? null } : undefined,
    });

    if (action === "complete") await recordPayout(booking);
    else if (action === "cancel") await withholdPayout(booking.id, "Booking cancelled by the platform.");

    await recordAdminAction(admin, {
      action: `booking.${action}`,
      targetType: "bookings",
      targetId: booking.id,
      reason,
      metadata: {
        reference: booking.reference,
        from: booking.status,
        refundDueMinor: action === "cancel" ? paid : 0,
        refundedMinor: action === "refund" ? paid : 0,
      },
    });

    const ownerId = booking.businesses?.owner_id;
    const messages = {
      cancel: {
        title: "Booking cancelled",
        body: `${booking.reference} was cancelled by the Concierge team. Reason: ${reason}`,
      },
      complete: {
        title: "Booking completed",
        body: `${booking.reference} was marked as completed by the Concierge team.`,
      },
      refund: {
        title: "Refund sent",
        body: `${formatNaira(paid)} for ${booking.reference} has been refunded to you.`,
      },
    }[action];
    await notify(
      {
        userId: booking.customer_id,
        type: `booking.admin_${action}`,
        ...messages,
        data: { bookingId: booking.id },
      },
      ...(ownerId && action !== "refund"
        ? [{ userId: ownerId, type: `booking.admin_${action}`, ...messages, data: { bookingId: booking.id } }]
        : []),
    );
    if (action === "cancel" && paid > 0)
      message = `Booking cancelled. ${formatNaira(paid)} is due back to the customer.`;
    if (action === "refund") message = `Refund of ${formatNaira(paid)} recorded.`;
  } catch (error) {
    return toFormError(error, "We couldn't update the booking. Please try again.");
  }
  refresh();
  return { status: "success", message };
}
