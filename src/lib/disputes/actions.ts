"use server";

import { redirect } from "next/navigation";
import { refreshPage } from "@/lib/utils/refresh";
import { z } from "zod";

import { canOpenDispute, type DisputeStatus } from "@/lib/admin/rules";
import { disputeMessageSchema, disputeOpenSchema } from "@/lib/admin/schemas";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole, type SessionUser } from "@/lib/auth/session";
import { holdPayout, recordPayout } from "@/lib/bookings/payouts";
import { moveBooking } from "@/lib/bookings/transitions";
import { toFormError } from "@/lib/business/action-utils";
import { AppError, logger } from "@/lib/errors";
import { notify, type NewNotification } from "@/lib/notifications";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { readEvidence, saveEvidence } from "./evidence";
import { isDisputeOpen } from "@/lib/admin/rules";

function disputePath(role: "customer" | "business", bookingId: string) {
  return role === "customer"
    ? `/account/bookings/${bookingId}/dispute`
    : `/business/bookings/${bookingId}/dispute`;
}

async function activeAdminIds(): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("status", "active");
  return (data ?? []).map((a) => a.id);
}

/**
 * The customer or the business opens a dispute on their booking, with a reason, a description and
 * optional evidence. The booking moves to "disputed", any payout is held, and the Concierge team is told.
 */
export async function openDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let destination: string;
  try {
    const user = await requireRole("customer", "business");
    await enforceRateLimit("dispute.open", user.id);
    const parsed = disputeOpenSchema.safeParse({
      bookingId: formData.get("bookingId"),
      reasonCode: formData.get("reasonCode"),
      reason: formData.get("reason"),
      description: formData.get("description"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { bookingId, reasonCode, reason, description } = parsed.data;
    const files = await readEvidence(formData);

    // Read with the user's own session: row level security only returns bookings they're part of.
    const supabase = await createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, reference, status, completed_at, customer_id, business_id, businesses(owner_id)")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) throw new AppError("NOT_FOUND", "Booking not found.");
    const ownerId = booking.businesses?.owner_id;
    const role = booking.customer_id === user.id ? "customer" : ownerId === user.id ? "business" : null;
    if (!role) throw new AppError("FORBIDDEN", "You can only open a dispute on your own bookings.");
    if (!canOpenDispute(booking))
      throw new AppError("CONFLICT", "You can't open a dispute on this booking any more.");

    const db = createAdminClient();
    const { count: earlier } = await db
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id);
    if (earlier)
      throw new AppError(
        "CONFLICT",
        "There's already a dispute for this booking. Add to it from the dispute page.",
      );

    const { data: dispute, error: insertError } = await db
      .from("disputes")
      .insert({
        booking_id: booking.id,
        opened_by: user.id,
        reason_code: reasonCode,
        reason,
        description,
        previous_booking_status: booking.status,
      })
      .select("id")
      .single();
    if (insertError?.code === "23505")
      throw new AppError("CONFLICT", "There's already a dispute for this booking.");
    if (insertError || !dispute)
      throw new AppError("INTERNAL", "Could not open the dispute.", { cause: insertError });

    try {
      await moveBooking({
        bookingId: booking.id,
        from: booking.status,
        to: "disputed",
        actorId: user.id,
        note: reason,
      });
    } catch (error) {
      await db.from("disputes").delete().eq("id", dispute.id);
      throw error;
    }
    await holdPayout(booking.id);
    if (files.length > 0) {
      try {
        await saveEvidence(dispute.id, { id: user.id, role }, files);
      } catch (error) {
        logger.error("Dispute opened but evidence failed", { error, disputeId: dispute.id });
      }
    }

    const otherParty = role === "customer" ? ownerId : booking.customer_id;
    await notify(
      ...(await activeAdminIds()).map((userId) => ({
        userId,
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
              title: "A dispute was opened",
              body: `A dispute was opened on ${booking.reference}. You can reply and add evidence on the dispute page.`,
              data: { bookingId: booking.id },
            },
          ]
        : []),
    );
    destination = disputePath(role, booking.id);
  } catch (error) {
    return toFormError(error, "We couldn't open the dispute. Please try again.");
  }
  redirect(destination);
}

/** The dispute as the signed-in customer or business owner sees it, and which side they're on. */
async function participantDispute(user: SessionUser, disputeId: string) {
  const supabase = await createClient();
  const { data: dispute } = await supabase
    .from("disputes")
    .select(
      "id, status, opened_by, previous_booking_status, booking:bookings(id, reference, status, customer_id, business_id, total_minor, commission_rate_bps, businesses(owner_id))",
    )
    .eq("id", disputeId)
    .maybeSingle();
  const booking = dispute?.booking;
  const ownerId = booking?.businesses?.owner_id;
  const role =
    booking?.customer_id === user.id ? "customer" : ownerId && ownerId === user.id ? "business" : null;
  if (!dispute || !booking || !role) throw new AppError("NOT_FOUND", "Dispute not found.");
  return {
    dispute: { ...dispute, status: dispute.status as DisputeStatus },
    booking,
    role,
    ownerId,
  } as const;
}

/** A message in the dispute thread from the customer or the business, with optional evidence. */
export async function postDisputeMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireRole("customer", "business");
    await enforceRateLimit("dispute.message", user.id);
    const parsed = disputeMessageSchema.safeParse({
      disputeId: formData.get("disputeId"),
      body: formData.get("body") ?? "",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { dispute, booking, role, ownerId } = await participantDispute(user, parsed.data.disputeId);
    if (!isDisputeOpen(dispute.status)) throw new AppError("CONFLICT", "This dispute is closed.");
    const files = await readEvidence(formData);
    if (!parsed.data.body && files.length === 0)
      return { status: "error", fieldErrors: { body: "Write a message or add a file." } };

    const db = createAdminClient();
    let messageId: string | null = null;
    if (parsed.data.body) {
      const { data, error } = await db
        .from("dispute_messages")
        .insert({ dispute_id: dispute.id, sender_id: user.id, sender_role: role, body: parsed.data.body })
        .select("id")
        .single();
      if (error || !data) throw new AppError("INTERNAL", "Could not send the message.", { cause: error });
      messageId = data.id;
    }
    await saveEvidence(dispute.id, { id: user.id, role }, files, messageId);

    const other = role === "customer" ? ownerId : booking.customer_id;
    const notifications: NewNotification[] = (await activeAdminIds()).map((userId) => ({
      userId,
      type: "dispute.message",
      title: `New in dispute ${booking.reference}`,
      body: `The ${role} added ${parsed.data.body ? "a message" : "evidence"}.`,
      data: { disputeId: dispute.id },
    }));
    if (other)
      notifications.push({
        userId: other,
        type: "dispute.message",
        title: `New in the dispute on ${booking.reference}`,
        body: "Open the dispute to read it.",
        data: { bookingId: booking.id },
      });
    await notify(...notifications);
  } catch (error) {
    return toFormError(error, "We couldn't send that. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Sent." };
}

/** Whoever opened the dispute can take it back before a decision; the booking returns to where it was. */
export async function withdrawDisputeAction(disputeId: string, _prev: FormState): Promise<FormState> {
  try {
    const user = await requireRole("customer", "business");
    const { dispute, booking, role, ownerId } = await participantDispute(user, z.guid().parse(disputeId));
    if (dispute.opened_by !== user.id)
      throw new AppError("FORBIDDEN", "Only whoever opened the dispute can withdraw it.");
    if (!isDisputeOpen(dispute.status) || booking.status !== "disputed")
      throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");

    const back =
      dispute.previous_booking_status && dispute.previous_booking_status !== "disputed"
        ? dispute.previous_booking_status
        : "completed";
    await moveBooking({
      bookingId: booking.id,
      from: "disputed",
      to: back,
      actorId: user.id,
      note: "Dispute withdrawn",
    });
    if (back === "completed" || back === "reviewed") await recordPayout(booking);

    const note = `Withdrawn by the ${role}.`;
    const { data, error } = await createAdminClient()
      .from("disputes")
      .update({
        status: "closed",
        outcome: "withdrawn",
        resolution: note,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
        change_actor_id: user.id,
        change_note: note,
      })
      .eq("id", dispute.id)
      .in("status", ["open", "under_review", "escalated"])
      .select("id");
    if (error) throw new AppError("INTERNAL", "Could not withdraw the dispute.", { cause: error });
    if (!data?.length) throw new AppError("CONFLICT", "This dispute changed. Refresh to see the latest.");

    const other = role === "customer" ? ownerId : booking.customer_id;
    await notify(
      ...[...(await activeAdminIds()), ...(other ? [other] : [])].map((userId) => ({
        userId,
        type: "dispute.closed",
        title: `Dispute on ${booking.reference} withdrawn`,
        body: note,
        data: { disputeId: dispute.id, bookingId: booking.id },
      })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't withdraw the dispute. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Dispute withdrawn." };
}
