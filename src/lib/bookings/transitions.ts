import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import type { BookingStatus } from "./rules";
import { canTransition } from "./workflow";

type BookingUpdate = Database["public"]["Tables"]["bookings"]["Update"];

/**
 * Moves a booking from one status to another on the server, recording who did it in the booking's
 * history. Only succeeds if the booking is still in `from` (protects against double submits and
 * races); `scope` limits it to the caller's own booking.
 */
export async function moveBooking(input: {
  bookingId: string;
  from: BookingStatus;
  to: BookingStatus;
  actorId: string | null;
  note?: string | null;
  changes?: Omit<BookingUpdate, "status" | "change_actor_id" | "change_note">;
  scope?: { customerId: string } | { businessId: string };
}): Promise<void> {
  if (!canTransition(input.from, input.to)) {
    throw new AppError(
      "CONFLICT",
      "That isn't possible for this booking any more. Refresh to see the latest.",
    );
  }
  let query = createAdminClient()
    .from("bookings")
    .update({
      ...input.changes,
      status: input.to,
      change_actor_id: input.actorId,
      change_note: input.note?.slice(0, 500) ?? null,
    })
    .eq("id", input.bookingId)
    .eq("status", input.from);
  if (input.scope && "customerId" in input.scope) query = query.eq("customer_id", input.scope.customerId);
  if (input.scope && "businessId" in input.scope) query = query.eq("business_id", input.scope.businessId);
  const { data, error } = await query.select("id");
  if (error) throw new AppError("INTERNAL", "Could not update the booking.", { cause: error });
  if (!data?.length) throw new AppError("CONFLICT", "This booking changed. Refresh to see the latest.");
}

/** Changes a booking's details without changing its status (for example, a new time). */
export async function updateBookingDetails(input: {
  bookingId: string;
  expectedStatus: BookingStatus;
  actorId: string;
  note?: string | null;
  changes: Omit<BookingUpdate, "status" | "change_actor_id" | "change_note">;
  scope: { customerId: string } | { businessId: string };
}): Promise<void> {
  await moveBooking({ ...input, from: input.expectedStatus, to: input.expectedStatus });
}
