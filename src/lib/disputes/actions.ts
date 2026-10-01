"use server";

import { refresh } from "next/cache";

import { canOpenDispute } from "@/lib/admin/rules";
import { disputeOpenSchema } from "@/lib/admin/schemas";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { holdPayout } from "@/lib/bookings/payouts";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The customer or the business reports a problem with a paid booking.
 * The booking moves to "disputed", any payout is held, and the Concierge team is notified.
 */
export async function openDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireRole("customer", "business");
    const parsed = disputeOpenSchema.safeParse({
      bookingId: formData.get("bookingId"),
      reason: formData.get("reason"),
      description: formData.get("description") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { bookingId, reason, description } = parsed.data;

    // Read with the user's own session: row level security only returns bookings they're part of.
    const supabase = await createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, reference, status, completed_at, customer_id, business_id, businesses(owner_id)")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) throw new AppError("NOT_FOUND", "Booking not found.");
    const ownerId = booking.businesses?.owner_id;
    const isCustomer = booking.customer_id === user.id;
    if (!isCustomer && ownerId !== user.id)
      throw new AppError("FORBIDDEN", "You can only report problems with your own bookings.");
    if (!canOpenDispute(booking))
      throw new AppError("CONFLICT", "You can't report a problem with this booking any more.");

    const db = createAdminClient();
    const { count: earlier } = await db
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id);
    if (earlier)
      throw new AppError(
        "CONFLICT",
        "A problem has already been reported for this booking. Contact support.",
      );

    const { data: dispute, error: insertError } = await db
      .from("disputes")
      .insert({
        booking_id: booking.id,
        opened_by: user.id,
        reason,
        description: description ?? null,
        previous_booking_status: booking.status,
      })
      .select("id")
      .single();
    if (insertError?.code === "23505")
      throw new AppError("CONFLICT", "A problem has already been reported for this booking.");
    if (insertError || !dispute)
      throw new AppError("INTERNAL", "Could not report the problem.", { cause: insertError });

    const { data: moved, error: moveError } = await db
      .from("bookings")
      .update({ status: "disputed" })
      .eq("id", booking.id)
      .eq("status", booking.status)
      .select("id");
    if (moveError || !moved?.length) {
      await db.from("disputes").delete().eq("id", dispute.id);
      throw new AppError("CONFLICT", "This booking changed. Refresh and try again.", { cause: moveError });
    }
    await holdPayout(booking.id);

    const { data: admins } = await db.from("users").select("id").eq("role", "admin").eq("status", "active");
    const otherParty = isCustomer ? ownerId : booking.customer_id;
    await notify(
      ...(admins ?? []).map((admin) => ({
        userId: admin.id,
        type: "dispute.opened",
        title: "New dispute",
        body: `${booking.reference}: ${reason}`,
        data: { disputeId: dispute.id, bookingId: booking.id },
      })),
      ...(otherParty
        ? [
            {
              userId: otherParty,
              type: "dispute.opened",
              title: "A problem was reported",
              body: `A problem was reported with ${booking.reference}. The Concierge team will look into it.`,
              data: { bookingId: booking.id },
            },
          ]
        : []),
    );
  } catch (error) {
    return toFormError(error, "We couldn't report the problem. Please try again.");
  }
  refresh();
  return {
    status: "success",
    message: "Thanks for telling us. Our team will review it and get back to you.",
  };
}
