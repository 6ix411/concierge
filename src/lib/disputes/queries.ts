import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { signEvidence } from "./evidence";

const DISPUTE_COLUMNS =
  "id, booking_id, opened_by, reason, reason_code, description, status, outcome, resolution, resolved_at, refund_due_minor, previous_booking_status, escalated_at, created_at";
const BOOKING_COLUMNS =
  "id, reference, status, scheduled_start, total_minor, customer_id, business_id, businesses(name, owner_id), booking_items(name, kind)";

async function loadThread(
  db: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  disputeId: string,
) {
  const [messages, evidence, events] = await Promise.all([
    db
      .from("dispute_messages")
      .select("id, sender_id, sender_role, body, internal, created_at")
      .eq("dispute_id", disputeId)
      .order("created_at"),
    db
      .from("dispute_evidence")
      .select(
        "id, message_id, uploaded_by, uploader_role, storage_path, file_name, mime_type, size_bytes, created_at",
      )
      .eq("dispute_id", disputeId)
      .order("created_at"),
    db
      .from("dispute_events")
      .select("id, event, from_status, to_status, actor_role, note, internal, created_at")
      .eq("dispute_id", disputeId)
      .order("created_at"),
  ]);
  for (const result of [messages, evidence, events])
    if (result.error) throw new AppError("INTERNAL", "Could not load the dispute.", { cause: result.error });
  return {
    messages: messages.data ?? [],
    evidence: await signEvidence(evidence.data ?? []),
    events: (events.data ?? []).filter((e) => e.event !== "evidence"),
  };
}

/**
 * The latest dispute on a booking, as the customer or business owner sees it. Row level security
 * limits everything to their own bookings and hides the Concierge team's internal notes.
 */
export async function getDisputeCase(bookingId: string) {
  const supabase = await createClient();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(`${BOOKING_COLUMNS}, disputes(${DISPUTE_COLUMNS})`)
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the dispute.", { cause: error });
  const dispute = booking?.disputes.toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!booking || !dispute) return null;
  const { data: names } = await supabase.rpc("get_booking_counterparts", { user_ids: [booking.customer_id] });
  return {
    dispute,
    booking,
    customerName: names?.[0]?.full_name ?? "Customer",
    ...(await loadThread(supabase, dispute.id)),
  };
}

/** A dispute with everything, internal notes included. Admin pages only (checked by the caller). */
export async function getAdminDisputeThread(disputeId: string) {
  return loadThread(createAdminClient(), disputeId);
}

export type DisputeCase = NonNullable<Awaited<ReturnType<typeof getDisputeCase>>>;
export type DisputeThread = Awaited<ReturnType<typeof getAdminDisputeThread>>;
