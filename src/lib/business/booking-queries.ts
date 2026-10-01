import "server-only";

import type { BookingStatus } from "@/lib/bookings/rules";
import { getCounterpartNames } from "@/lib/chat/queries";
import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const bookingTabs = {
  requests: { label: "Requests", statuses: ["quote_requested", "requested"] },
  upcoming: { label: "Upcoming", statuses: ["quoted", "accepted", "confirmed", "in_progress"] },
  past: { label: "Past", statuses: ["completed", "cancelled", "rejected", "expired", "disputed"] },
} as const satisfies Record<string, { label: string; statuses: BookingStatus[] }>;

export type BookingTab = keyof typeof bookingTabs;

/** The business's bookings in a tab, with customer names (never contact details). */
export async function listBusinessBookings(businessId: string, tab: BookingTab, limit = 50) {
  const supabase = await createClient();
  const statuses: BookingStatus[] = [...bookingTabs[tab].statuses];
  let query = supabase
    .from("bookings")
    .select(
      "id, reference, status, scheduled_start, total_minor, customer_id, created_at, booking_items(name)",
    )
    .eq("business_id", businessId)
    .in("status", statuses)
    .limit(limit);
  query =
    tab === "past"
      ? query.order("scheduled_start", { ascending: false, nullsFirst: false })
      : query.order("scheduled_start", { ascending: true, nullsFirst: false });
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load your bookings.", { cause: error });
  const bookings = data ?? [];
  const names = await getCounterpartNames(bookings.map((b) => b.customer_id));
  return bookings.map((b) => ({ ...b, customerName: names.get(b.customer_id) ?? "Customer" }));
}

export type BusinessBookingListItem = Awaited<ReturnType<typeof listBusinessBookings>>[number];

export async function getBusinessBooking(bookingId: string, businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, reference, status, scheduled_start, scheduled_end, address_line, city, state, customer_notes, quote_notes, subtotal_minor, total_minor, commission_rate_bps, customer_id, created_at, accepted_at, confirmed_at, completed_at, cancelled_at, cancellation_reason, booking_items(id, name, unit_price_minor, quantity, total_minor), conversations(id)",
    )
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load this booking.", { cause: error });
  if (!data) return null;
  const names = await getCounterpartNames([data.customer_id]);
  return { ...data, customerName: names.get(data.customer_id) ?? "Customer" };
}
