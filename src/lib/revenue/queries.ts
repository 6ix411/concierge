import "server-only";

import type { BookingFeeRule } from "@/lib/bookings/rules";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { BOOKING_FEE_SETTING, FEATURED_SLOTS_SETTING, parseBookingFee } from "./rules";

/** The booking fee customers pay right now (read on the server; it is never sent by the browser). */
export async function getBookingFeeRule(): Promise<BookingFeeRule> {
  const { data, error } = await createAdminClient()
    .from("platform_settings")
    .select("value")
    .eq("key", BOOKING_FEE_SETTING)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not read the booking fee.", { cause: error });
  return parseBookingFee(data?.value);
}

export async function getFeaturedSlots(): Promise<number> {
  const { data } = await createAdminClient()
    .from("platform_settings")
    .select("value")
    .eq("key", FEATURED_SLOTS_SETTING)
    .maybeSingle();
  const slots = Number(data?.value);
  return Number.isInteger(slots) ? slots : 3;
}

export type Plan = {
  code: string;
  name: string;
  description: string | null;
  monthly_price_minor: number;
  perks: string[];
  sort_order: number;
};

/** Plans businesses can choose (active ones; Free is always active). */
export async function getPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("code, name, description, monthly_price_minor, perks, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new AppError("INTERNAL", "Could not load plans.", { cause: error });
  return data ?? [];
}

export type FeaturedPackage = { code: string; name: string; duration_days: number; price_minor: number };

export async function getFeaturedPackages(): Promise<FeaturedPackage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("featured_packages")
    .select("code, name, duration_days, price_minor")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new AppError("INTERNAL", "Could not load featured placement options.", { cause: error });
  return data ?? [];
}

export type BusinessBilling = {
  planCode: string;
  /** Featured right now, and the end of the last placement already paid for (null if none). */
  featuredNow: boolean;
  featuredUntil: string | null;
  /** The paid period running now, if any, and any already paid for after it. */
  periods: { plan_code: string; period_start: string; period_end: string; price_minor: number }[];
  placements: { id: string; package_code: string; starts_at: string; ends_at: string; status: string }[];
  charges: {
    id: string;
    kind: string;
    item_code: string;
    reference: string;
    amount_minor: number;
    status: string;
    paid_at: string | null;
    created_at: string;
  }[];
};

/** The business's plan, placements and payments to the platform, read as its owner (RLS applies). */
export async function getBusinessBilling(businessId: string): Promise<BusinessBilling> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [plan, periods, placements, charges] = await Promise.all([
    supabase.rpc("current_plan_code", { p_business_id: businessId }),
    supabase
      .from("business_subscriptions")
      .select("plan_code, period_start, period_end, price_minor")
      .eq("business_id", businessId)
      .eq("status", "active")
      .gt("period_end", now)
      .order("period_start"),
    supabase
      .from("featured_placements")
      .select("id, package_code, starts_at, ends_at, status")
      .eq("business_id", businessId)
      .order("starts_at", { ascending: false })
      .limit(10),
    supabase
      .from("business_charges")
      .select("id, kind, item_code, reference, amount_minor, status, paid_at, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const error = plan.error ?? periods.error ?? placements.error ?? charges.error;
  if (error) throw new AppError("INTERNAL", "Could not load your plan.", { cause: error });
  const at = (value: string) => new Date(value).getTime();
  const nowMs = at(now);
  const running = (placements.data ?? []).filter((p) => p.status === "active" && at(p.ends_at) > nowMs);
  return {
    planCode: plan.data ?? "free",
    featuredNow: running.some((p) => at(p.starts_at) <= nowMs),
    featuredUntil: running.sort((a, b) => at(a.ends_at) - at(b.ends_at)).at(-1)?.ends_at ?? null,
    periods: periods.data ?? [],
    placements: placements.data ?? [],
    charges: charges.data ?? [],
  };
}

/** The start of a reporting period ending now; null days means all time. */
export function periodStart(days: number | null): Date {
  return days === null ? new Date(0) : new Date(Date.now() - days * 86_400_000);
}
