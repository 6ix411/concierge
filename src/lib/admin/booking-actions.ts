"use server";

import { refresh } from "next/cache";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { recordPayout, withholdPayout } from "@/lib/bookings/payouts";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { adminBookingActions, type AdminBookingAction } from "./rules";
import { bookingAdminSchema } from "./schemas";

/** Complete or cancel a booking on behalf of the platform. Logged, and both sides are notified. */
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
        "id, reference, status, customer_id, business_id, total_minor, commission_rate_bps, businesses(owner_id), payments(status, amount_minor, refunded_minor)",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) throw new AppError("NOT_FOUND", "Booking not found.");
    const rule = adminBookingActions[action];
    if (!rule.from.includes(booking.status))
      throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");

    const { data, error } = await db
      .from("bookings")
      .update(
        action === "cancel"
          ? { status: "cancelled", cancelled_by: admin.id, cancellation_reason: reason ?? null }
          : { status: "completed" },
      )
      .eq("id", booking.id)
      .eq("status", booking.status)
      .select("id");
    if (error) throw new AppError("INTERNAL", "Could not update the booking.", { cause: error });
    if (!data?.length) throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");

    const paid = booking.payments
      .filter((p) => p.status === "success" || p.status === "partially_refunded")
      .reduce((sum, p) => sum + p.amount_minor - p.refunded_minor, 0);
    if (action === "complete") await recordPayout(booking);
    else await withholdPayout(booking.id, "Booking cancelled by the platform.");

    await recordAdminAction(admin, {
      action: `booking.${action}`,
      targetType: "bookings",
      targetId: booking.id,
      reason,
      metadata: {
        reference: booking.reference,
        from: booking.status,
        refundDueMinor: action === "cancel" ? paid : 0,
      },
    });

    const ownerId = booking.businesses?.owner_id;
    const body =
      action === "cancel"
        ? `${booking.reference} was cancelled by the Concierge team. Reason: ${reason}`
        : `${booking.reference} was marked as completed by the Concierge team.`;
    const title = action === "cancel" ? "Booking cancelled" : "Booking completed";
    await notify(
      {
        userId: booking.customer_id,
        type: `booking.admin_${action}`,
        title,
        body,
        data: { bookingId: booking.id },
      },
      ...(ownerId
        ? [{ userId: ownerId, type: `booking.admin_${action}`, title, body, data: { bookingId: booking.id } }]
        : []),
    );
    if (action === "cancel" && paid > 0)
      message = `Booking cancelled. ${formatNaira(paid)} is due back to the customer.`;
  } catch (error) {
    return toFormError(error, "We couldn't update the booking. Please try again.");
  }
  refresh();
  return { status: "success", message };
}
