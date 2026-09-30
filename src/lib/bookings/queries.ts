import "server-only";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

import { activeStatuses } from "./rules";

const listColumns =
  "id, reference, status, scheduled_start, total_minor, created_at, businesses(name, slug, logo_path), booking_items(name)";

/** The signed-in customer's bookings (RLS limits rows to their own). */
export async function listCustomerBookings(customerId: string, view: "upcoming" | "past") {
  const supabase = await createClient();
  let query = supabase.from("bookings").select(listColumns).eq("customer_id", customerId);
  query =
    view === "upcoming"
      ? query.in("status", activeStatuses).order("scheduled_start", { ascending: true, nullsFirst: false })
      : query
          .not("status", "in", `(${activeStatuses.join(",")})`)
          .order("scheduled_start", { ascending: false });
  const { data, error } = await query.limit(50);
  if (error) throw new AppError("INTERNAL", "Could not load your bookings.", { cause: error });
  return data ?? [];
}

export type BookingListItem = Awaited<ReturnType<typeof listCustomerBookings>>[number];

export async function getCustomerBooking(customerId: string, bookingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, reference, status, scheduled_start, scheduled_end, address_line, city, state, customer_notes, quote_notes, subtotal_minor, platform_fee_minor, total_minor, created_at, accepted_at, confirmed_at, completed_at, cancelled_at, cancellation_reason, businesses(id, name, slug, logo_path, is_verified), booking_items(id, name, unit_price_minor, quantity, total_minor), conversations(id, status), reviews(id, rating), payments(id, status, amount_minor, paid_at, provider)",
    )
    .eq("id", bookingId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the booking.", { cause: error });
  return data;
}

export type CustomerBooking = NonNullable<Awaited<ReturnType<typeof getCustomerBooking>>>;
