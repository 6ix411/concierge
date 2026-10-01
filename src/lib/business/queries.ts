import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess, type SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { onboardingProgress, type OnboardingSnapshot } from "./onboarding";

const BUSINESS_COLUMNS =
  "id, owner_id, name, slug, description, primary_category_id, email, phone, website, address_line, city, state, logo_path, cover_path, status, is_verified, verified_at, rating_avg, rating_count, accepting_bookings, min_notice_hours, booking_window_days, max_bookings_per_day, submitted_at, reviewed_at, created_at";

/**
 * The signed-in owner's business, or null. Callers pass the session user's id. Read with the service
 * role because the business's phone and email aren't readable by clients (kept private by default).
 */
export const getOwnBusiness = cache(async (ownerId: string) => {
  const { data, error } = await createAdminClient()
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load your business.", { cause: error });
  return data;
});

export type OwnBusiness = NonNullable<Awaited<ReturnType<typeof getOwnBusiness>>>;

/**
 * For business dashboard pages: the owner and their business.
 * Owners without a business yet are sent to registration; admins go to their own dashboard.
 */
export async function requireOwnBusiness(): Promise<{ user: SessionUser; business: OwnBusiness }> {
  const user = await requireAreaAccess("business");
  if (user.role === "admin") redirect(adminHref());
  const business = await getOwnBusiness(user.id);
  if (!business) redirect("/business/setup");
  return { user, business };
}

/**
 * The platform's note on the latest decision (for example why a registration was rejected).
 * status_reason isn't readable by clients, so it's read with the service role after the
 * caller's ownership has been established by `requireOwnBusiness`.
 */
export async function getStatusNote(businessId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("businesses")
    .select("status_reason")
    .eq("id", businessId)
    .maybeSingle();
  return data?.status_reason ?? null;
}

export async function getOnboardingSnapshot(business: OwnBusiness): Promise<OnboardingSnapshot> {
  const supabase = await createClient();
  const count = { count: "exact", head: true } as const;
  const [areas, services, days, portfolio, documents] = await Promise.all([
    supabase.from("service_areas").select("id", count).eq("business_id", business.id),
    supabase
      .from("business_services")
      .select("id", count)
      .eq("business_id", business.id)
      .eq("is_active", true)
      .eq("is_addon", false),
    supabase
      .from("business_availability")
      .select("id", count)
      .eq("business_id", business.id)
      .not("day_of_week", "is", null)
      .eq("is_available", true),
    supabase.from("business_portfolio").select("id", count).eq("business_id", business.id),
    supabase.from("business_verifications").select("id", count).eq("business_id", business.id),
  ]);
  for (const result of [areas, services, days, portfolio, documents]) {
    if (result.error)
      throw new AppError("INTERNAL", "Could not load your registration.", { cause: result.error });
  }
  return {
    business,
    areaCount: areas.count ?? 0,
    mainServiceCount: services.count ?? 0,
    openDayCount: days.count ?? 0,
    portfolioCount: portfolio.count ?? 0,
    verificationCount: documents.count ?? 0,
  };
}

export async function getOnboardingProgress(business: OwnBusiness) {
  return onboardingProgress(await getOnboardingSnapshot(business));
}

export async function listOwnServices(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_services")
    .select(
      "id, name, description, category_id, pricing_type, price_minor, duration_minutes, is_package, is_addon, package_includes, is_active, sort_order",
    )
    .eq("business_id", businessId)
    .order("is_addon")
    .order("sort_order")
    .order("created_at");
  if (error) throw new AppError("INTERNAL", "Could not load your services.", { cause: error });
  return data ?? [];
}

export type OwnService = Awaited<ReturnType<typeof listOwnServices>>[number];

export async function listServiceAreas(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_areas")
    .select("id, state, city, area")
    .eq("business_id", businessId)
    .order("state")
    .order("area");
  if (error) throw new AppError("INTERNAL", "Could not load your service areas.", { cause: error });
  return data ?? [];
}

export async function listAvailability(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_availability")
    .select("id, day_of_week, specific_date, start_time, end_time, is_available")
    .eq("business_id", businessId);
  if (error) throw new AppError("INTERNAL", "Could not load your availability.", { cause: error });
  return data ?? [];
}

export async function listPortfolio(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_portfolio")
    .select("id, media_type, storage_path, caption, sort_order")
    .eq("business_id", businessId)
    .order("sort_order")
    .order("created_at");
  if (error) throw new AppError("INTERNAL", "Could not load your portfolio.", { cause: error });
  return data ?? [];
}

export async function getVerificationOverview(businessId: string) {
  const supabase = await createClient();
  const [documents, requests] = await Promise.all([
    supabase
      .from("business_verifications")
      .select(
        "id, document_type, document_number, notes, status, review_notes, request_id, created_at, reviewed_at",
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
    supabase
      .from("verification_requests")
      .select("id, document_type, message, status, created_at, resolved_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
  ]);
  if (documents.error || requests.error)
    throw new AppError("INTERNAL", "Could not load your verification.", {
      cause: documents.error ?? requests.error,
    });
  return { documents: documents.data ?? [], requests: requests.data ?? [] };
}
