import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

const count = z.coerce.number().int().nonnegative();
const money = z.coerce.number().nonnegative();

const statsSchema = z.object({
  customers: count,
  businesses: count,
  pending_businesses: count,
  approved_businesses: count,
  active_bookings: count,
  completed_bookings: count,
  cancelled_bookings: count,
  revenue_minor: money,
  platform_fees_minor: money,
  pending_payouts_minor: money,
  pending_payouts: count,
  open_disputes: count,
  disputes: count,
  reviews: count,
  hidden_reviews: count,
  average_rating: z.coerce.number().nullable(),
  monthly: z.array(z.object({ month: z.string(), bookings: count, revenue_minor: money })),
  popular_categories: z.array(
    z.object({ id: z.string(), name: z.string(), slug: z.string(), bookings: count, businesses: count }),
  ),
  popular_services: z.array(
    z.object({ id: z.string(), name: z.string(), business_name: z.string(), bookings: count }),
  ),
  top_businesses: z.array(
    z.object({ id: z.string(), name: z.string(), slug: z.string(), bookings: count, value_minor: money }),
  ),
});

export type AdminStats = z.infer<typeof statsSchema>;

/** Marketplace numbers for the admin overview. Call only after checking the user is an admin. */
export async function getAdminStats(topN = 5): Promise<AdminStats> {
  const { data, error } = await createAdminClient().rpc("admin_dashboard_stats", { top_n: topN });
  if (error) throw new AppError("INTERNAL", "Could not load the dashboard numbers.", { cause: error });
  return statsSchema.parse(data);
}
