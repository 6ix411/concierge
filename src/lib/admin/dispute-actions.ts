"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { recordPayout, withholdPayout } from "@/lib/bookings/payouts";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { bookingStatusAfterDispute, disputeOutcomes, type DisputeOutcome } from "./rules";
import { disputeResolveSchema } from "./schemas";

async function loadDispute(disputeId: string) {
  const { data } = await createAdminClient()
    .from("disputes")
    .select(
      "id, status, previous_booking_status, booking:bookings(id, reference, status, customer_id, business_id, total_minor, commission_rate_bps, businesses(owner_id), payments(status, amount_minor, refunded_minor))",
    )
    .eq("id", disputeId)
    .maybeSingle();
  if (!data?.booking) throw new AppError("NOT_FOUND", "Dispute not found.");
  return { ...data, booking: data.booking };
}

/** Lets both sides know the team has picked the dispute up. */
export async function startDisputeReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const disputeId = z.guid().parse(formData.get("disputeId"));
    const dispute = await loadDispute(disputeId);
    if (dispute.status !== "open")
      throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");
    const { data } = await createAdminClient()
      .from("disputes")
      .update({ status: "under_review" })
      .eq("id", dispute.id)
      .eq("status", "open")
      .select("id");
    if (!data?.length) throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");
    await recordAdminAction(admin, {
      action: "dispute.start_review",
      targetType: "disputes",
      targetId: dispute.id,
      metadata: { reference: dispute.booking.reference },
    });
  } catch (error) {
    return toFormError(error, "We couldn't update the dispute. Please try again.");
  }
  refresh();
  return { status: "success", message: "Marked as under review." };
}

/** Closes a dispute: side with the business, refund the customer, or dismiss it. */
export async function resolveDisputeAction(
  outcome: DisputeOutcome,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let message = "Dispute closed.";
  try {
    const admin = await requireRole("admin");
    const parsed = disputeResolveSchema.safeParse({
      disputeId: formData.get("disputeId"),
      resolution: formData.get("resolution"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const dispute = await loadDispute(parsed.data.disputeId);
    const { booking } = dispute;
    if (!["open", "under_review"].includes(dispute.status) || booking.status !== "disputed")
      throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");

    const db = createAdminClient();
    const nextStatus = bookingStatusAfterDispute(outcome, dispute.previous_booking_status);
    const { data: moved, error: moveError } = await db
      .from("bookings")
      .update(
        nextStatus === "cancelled"
          ? { status: nextStatus, cancelled_by: admin.id, cancellation_reason: "Refunded after a dispute." }
          : { status: nextStatus },
      )
      .eq("id", booking.id)
      .eq("status", "disputed")
      .select("id");
    if (moveError) throw new AppError("INTERNAL", "Could not update the booking.", { cause: moveError });
    if (!moved?.length) throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");

    const paid = booking.payments
      .filter((p) => p.status === "success" || p.status === "partially_refunded")
      .reduce((sum, p) => sum + p.amount_minor - p.refunded_minor, 0);
    const refundDue = outcome === "customer" ? paid : 0;
    if (nextStatus === "completed") await recordPayout(booking);
    if (outcome === "customer") await withholdPayout(booking.id, "Customer refunded after a dispute.");

    const { error } = await db
      .from("disputes")
      .update({
        status: disputeOutcomes[outcome].disputeStatus,
        outcome,
        resolution: parsed.data.resolution,
        resolved_by: admin.id,
        resolved_at: new Date().toISOString(),
        refund_due_minor: refundDue,
      })
      .eq("id", dispute.id);
    if (error) throw new AppError("INTERNAL", "Could not close the dispute.", { cause: error });

    await recordAdminAction(admin, {
      action: `dispute.${outcome}`,
      targetType: "disputes",
      targetId: dispute.id,
      reason: parsed.data.resolution,
      metadata: { reference: booking.reference, bookingStatus: nextStatus, refundDueMinor: refundDue },
    });

    const body = `The Concierge team reviewed the problem with ${booking.reference}: ${parsed.data.resolution}`;
    const ownerId = booking.businesses?.owner_id;
    await notify(
      ...[booking.customer_id, ownerId]
        .filter((id): id is string => Boolean(id))
        .map((userId) => ({
          userId,
          type: "dispute.closed",
          title: "Dispute closed",
          body,
          data: { bookingId: booking.id },
        })),
    );
    if (refundDue > 0) message = `Dispute closed. ${formatNaira(refundDue)} is due back to the customer.`;
  } catch (error) {
    return toFormError(error, "We couldn't close the dispute. Please try again.");
  }
  refresh();
  return { status: "success", message };
}
