import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import type { DailyPoint } from "./rules";

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  searches: number;
  profile_views: number;
  booking_requests: number;
  completed_bookings: number;
};
export type LocationRow = { state: string; city: string | null; searches: number; booking_requests: number };

export type PlatformAnalytics = {
  customer_registrations: number;
  business_registrations: number;
  businesses_approved: number;
  approved_businesses_now: number;
  searches: number;
  concierge_searches: number;
  searches_with_results: number;
  ai_conversations: number;
  ai_conversations_booked: number;
  provider_matches: number;
  providers_matched: number;
  profile_views: number;
  booking_requests: number;
  confirmed_bookings: number;
  completed_bookings: number;
  cancellations: number;
  declined: number;
  requests_confirmed: number;
  requests_completed: number;
  requests_cancelled: number;
  customer_payments_minor: number;
  refunded_minor: number;
  commission_minor: number;
  booking_fees_minor: number;
  business_charges_minor: number;
  provider_earnings_minor: number;
  paid_bookings: number;
  average_booking_minor: number;
  categories: CategoryRow[];
  locations: LocationRow[];
  daily: DailyPoint[];
};

/** Platform-wide numbers for [from, to). Admin pages only, after `requireAreaAccess("admin")`. */
export async function getPlatformAnalytics(from: Date, to: Date | null = null): Promise<PlatformAnalytics> {
  const { data, error } = await createAdminClient().rpc("get_platform_analytics", {
    p_from: from.toISOString(),
    p_to: to ? to.toISOString() : "infinity",
  });
  if (error) throw new AppError("INTERNAL", "Could not load analytics.", { cause: error });
  return data as unknown as PlatformAnalytics;
}

export type BusinessAnalytics = {
  profile_views: number;
  search_appearances: number;
  booking_requests: number;
  confirmed_bookings: number;
  completed_bookings: number;
  cancellations: number;
};

/** One business's numbers. Callers must have checked the signed-in user owns the business. */
export async function getBusinessAnalytics(businessId: string, from: Date): Promise<BusinessAnalytics> {
  const { data, error } = await createAdminClient()
    .rpc("get_business_analytics", {
      p_business_id: businessId,
      p_from: from.toISOString(),
      p_to: "infinity",
    })
    .single();
  if (error) throw new AppError("INTERNAL", "Could not load your numbers.", { cause: error });
  return data;
}
