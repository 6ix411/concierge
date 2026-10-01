import "server-only";

import { cache } from "react";

import { AppError } from "@/lib/errors";
import { findMatches } from "@/lib/matching/engine";
import { signReviewPhotos } from "@/lib/reviews/photos";
import type { Match } from "@/lib/matching/types";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type SearchResult = Match;
export type PublicReview = Database["public"]["Functions"]["get_public_reviews"]["Returns"][number] & {
  /** Signed links to the review's photos. */
  photo_urls: string[];
};

export type SearchParams = {
  query?: string | null;
  category?: string | null;
  location?: string | null;
  /** YYYY-MM-DD: ranks businesses free that day first and says who isn't. */
  date?: string | null;
  guests?: number | null;
  maxPriceMinor?: number | null;
  sort?: "relevance" | "rating" | "price_low" | "price_high";
  limit?: number;
  offset?: number;
};

/** Searches eligible businesses on the platform only (enforced in the database by the matching engine). */
export async function searchBusinesses(params: SearchParams): Promise<SearchResult[]> {
  return findMatches({
    query: params.query,
    category: params.category,
    location: params.location,
    date: params.date,
    guests: params.guests,
    budgetMinor: params.maxPriceMinor,
    maxPriceMinor: params.maxPriceMinor,
    sort: !params.sort || params.sort === "relevance" ? "match" : params.sort,
    limit: params.limit,
    offset: params.offset,
  });
}

export type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
};
export type CategoryTree = Category & { children: Category[] };

export const getCategories = cache(async (): Promise<CategoryTree[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_categories")
    .select("id, name, slug, description, icon, parent_id")
    .order("sort_order")
    .order("name");
  if (error) throw new AppError("INTERNAL", "Could not load categories.", { cause: error });
  const top = (data ?? []).filter((c) => !c.parent_id);
  return top.map((parent) => ({
    ...parent,
    children: (data ?? []).filter((c) => c.parent_id === parent.id),
  }));
});

export const getBusinessBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data: business, error } = await supabase
    .from("businesses")
    .select(
      "id, name, slug, description, city, state, logo_path, cover_path, status, is_verified, verified_at, rating_avg, rating_count, created_at, accepting_bookings, min_notice_hours, booking_window_days, primary_category:service_categories(name, slug)",
    )
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load this business.", { cause: error });
  if (!business) return null;

  const [services, areas, availability, portfolio, reviews, stats] = await Promise.all([
    supabase
      .from("business_services")
      .select(
        "id, name, description, pricing_type, price_minor, duration_minutes, is_package, is_addon, package_includes, category_id",
      )
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("service_areas").select("state, city, area").eq("business_id", business.id).order("area"),
    supabase
      .from("business_availability")
      .select("day_of_week, specific_date, start_time, end_time, is_available")
      .eq("business_id", business.id),
    supabase
      .from("business_portfolio")
      .select("id, media_type, storage_path, caption")
      .eq("business_id", business.id)
      .order("sort_order"),
    supabase.rpc("get_public_reviews", { p_business_id: business.id, p_limit: 20 }),
    supabase.rpc("get_business_stats", { p_business_id: business.id }).maybeSingle(),
  ]);

  for (const result of [services, areas, availability, portfolio, reviews, stats]) {
    if (result.error)
      throw new AppError("INTERNAL", "Could not load this business.", { cause: result.error });
  }

  // Only published reviews of an approved business come back, so their photos are safe to show.
  const signed = await signReviewPhotos((reviews.data ?? []).flatMap((r) => r.photo_paths ?? []));
  const publicReviews: PublicReview[] = (reviews.data ?? []).map((review) => ({
    ...review,
    photo_urls: (review.photo_paths ?? []).flatMap((path) => signed.get(path) ?? []),
  }));

  return {
    ...business,
    services: services.data ?? [],
    areas: areas.data ?? [],
    availability: availability.data ?? [],
    portfolio: portfolio.data ?? [],
    reviews: publicReviews,
    stats: {
      completedBookings: stats.data?.completed_bookings ?? 0,
      minPriceMinor: stats.data?.min_price_minor ?? null,
      maxPriceMinor: stats.data?.max_price_minor ?? null,
      hasQuoteOnly: stats.data?.has_quote_only ?? false,
      /** Published reviews with 1 to 5 stars. */
      ratingBreakdown: stats.data?.rating_breakdown ?? [0, 0, 0, 0, 0],
    },
  };
});

export type BusinessProfile = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;
export type BusinessService = BusinessProfile["services"][number];
