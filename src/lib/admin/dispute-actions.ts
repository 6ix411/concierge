"use server";

import { refreshPage } from "@/lib/utils/refresh";
import { z } from "zod";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { recordPayout, withholdPayout } from "@/lib/bookings/payouts";
import { moveBooking } from "@/lib/bookings/transitions";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { readEvidence, saveEvidence } from "@/lib/disputes/evidence";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { bookingStatusAfterDispute, disputeOutcomes, type DisputeOutcome } from "./rules";
import { disputeEscalateSchema, disputeMessageSchema, disputeResolveSchema } from "./schemas";

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
      .update({ status: "under_review", change_actor_id: admin.id, change_note: null })
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
    await notify(
      ...partiesOf(dispute.booking).map((userId) => ({
        userId,
        type: "dispute.under_review",
        title: `Dispute on ${dispute.booking.reference} under review`,
        body: "The Concierge team is looking into it. We may message you on the dispute for more details.",
        data: { bookingId: dispute.booking.id },
      })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't update the dispute. Please try again.");
  }
  refreshPage();
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
    if (!["open", "under_review", "escalated"].includes(dispute.status) || booking.status !== "disputed")
      throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");

    const db = createAdminClient();
    const nextStatus = bookingStatusAfterDispute(outcome, dispute.previous_booking_status);
    await moveBooking({
      bookingId: booking.id,
      from: "disputed",
      to: nextStatus,
      actorId: admin.id,
      note: parsed.data.resolution,
      changes:
        nextStatus === "cancelled"
          ? { cancelled_by: admin.id, cancellation_reason: "Refund due after a dispute." }
          : undefined,
    });

    const paid = booking.payments
      .filter((p) => p.status === "success" || p.status === "partially_refunded")
      .reduce((sum, p) => sum + p.amount_minor - p.refunded_minor, 0);
    const refundDue = outcome === "customer" ? paid : 0;
    if (nextStatus === "completed" || nextStatus === "reviewed") await recordPayout(booking);
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
        change_actor_id: admin.id,
        change_note: parsed.data.resolution,
      })
      .eq("id", dispute.id)
      .in("status", ["open", "under_review", "escalated"]);
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
  refreshPage();
  return { status: "success", message };
}

/** Both parties of a dispute, for notifications. */
function partiesOf(booking: { customer_id: string; businesses: { owner_id: string } | null }): string[] {
  return [booking.customer_id, booking.businesses?.owner_id].filter((id): id is string => Boolean(id));
}

/**
 * Escalates a dispute that needs a senior decision or outside action (the payment provider, legal).
 * Both sides are told it's escalated; the reason stays with the Concierge team.
 */
export async function escalateDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = disputeEscalateSchema.safeParse({
      disputeId: formData.get("disputeId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const dispute = await loadDispute(parsed.data.disputeId);
    const db = createAdminClient();
    const { data } = await db
      .from("disputes")
      .update({
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: parsed.data.reason,
        change_actor_id: admin.id,
        change_note: parsed.data.reason,
      })
      .eq("id", dispute.id)
      .in("status", ["open", "under_review"])
      .select("id");
    if (!data?.length) throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");
    await recordAdminAction(admin, {
      action: "dispute.escalate",
      targetType: "disputes",
      targetId: dispute.id,
      reason: parsed.data.reason,
      metadata: { reference: dispute.booking.reference },
    });
    const { data: admins } = await db.from("users").select("id").eq("role", "admin").eq("status", "active");
    await notify(
      ...partiesOf(dispute.booking).map((userId) => ({
        userId,
        type: "dispute.escalated",
        title: `Dispute on ${dispute.booking.reference} escalated`,
        body: "It has gone to a senior member of the Concierge team. It may take a little longer to settle.",
        data: { bookingId: dispute.booking.id },
      })),
      ...(admins ?? [])
        .filter((a) => a.id !== admin.id)
        .map((a) => ({
          userId: a.id,
          type: "dispute.escalated",
          title: `Dispute ${dispute.booking.reference} escalated`,
          body: parsed.data.reason,
          data: { disputeId: dispute.id },
        })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't escalate the dispute. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Escalated." };
}

/**
 * A message from the Concierge team in the dispute thread, with optional files. An internal note is
 * seen by admins only.
 */
export async function adminDisputeMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let internal = false;
  try {
    const admin = await requireRole("admin");
    const parsed = disputeMessageSchema.safeParse({
      disputeId: formData.get("disputeId"),
      body: formData.get("body") ?? "",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    internal = formData.get("internal") === "on";
    const dispute = await loadDispute(parsed.data.disputeId);
    const files = await readEvidence(formData);
    if (!parsed.data.body && files.length === 0)
      return { status: "error", fieldErrors: { body: "Write a message or add a file." } };
    if (internal && files.length > 0)
      return { status: "error", message: "Internal notes can't carry files: both sides see every file." };

    const db = createAdminClient();
    let messageId: string | null = null;
    if (parsed.data.body) {
      const { data, error } = await db
        .from("dispute_messages")
        .insert({
          dispute_id: dispute.id,
          sender_id: admin.id,
          sender_role: "admin",
          body: parsed.data.body,
          internal,
        })
        .select("id")
        .single();
      if (error || !data) throw new AppError("INTERNAL", "Could not send the message.", { cause: error });
      messageId = data.id;
    }
    await saveEvidence(dispute.id, { id: admin.id, role: "admin" }, files, messageId);
    await recordAdminAction(admin, {
      action: internal ? "dispute.note" : "dispute.message",
      targetType: "disputes",
      targetId: dispute.id,
      metadata: { files: files.length },
    });
    if (!internal)
      await notify(
        ...partiesOf(dispute.booking).map((userId) => ({
          userId,
          type: "dispute.message",
          title: `The Concierge team wrote about ${dispute.booking.reference}`,
          body: "Open the dispute to read it.",
          data: { bookingId: dispute.booking.id },
        })),
      );
  } catch (error) {
    return toFormError(error, "We couldn't send that. Please try again.");
  }
  refreshPage();
  return { status: "success", message: internal ? "Note saved." : "Sent to both sides." };
}
