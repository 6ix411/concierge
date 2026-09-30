import "server-only";

import { cache } from "react";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type SearchResult = Database["public"]["Functions"]["search_businesses"]["Returns"][number];
export type PublicReview = Database["public"]["Functions"]["get_public_reviews"]["Returns"][number];

export type SearchParams = {
  query?: string | null;
  category?: string | null;
  location?: string | null;
  maxPriceMinor?: number | null;
  sort?: "relevance" | "rating" | "price_low" | "price_high";
  limit?: number;
  offset?: number;
};

/** Searches approved businesses only (enforced in the database). */
export async function searchBusinesses(params: SearchParams): Promise<SearchResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_businesses", {
    p_query: params.query || undefined,
    p_category: params.category || undefined,
    p_location: params.location || undefined,
    p_max_price_minor: params.maxPriceMinor ?? undefined,
    p_sort: params.sort ?? "relevance",
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
  if (error) throw new AppError("INTERNAL", "Search is unavailable right now.", { cause: error });
  return data ?? [];
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
      "id, name, slug, description, city, state, logo_path, cover_path, status, is_verified, verified_at, rating_avg, rating_count, created_at, primary_category:service_categories(name, slug)",
    )
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load this business.", { cause: error });
  if (!business) return null;

  const [services, areas, availability, portfolio, reviews] = await Promise.all([
    supabase
      .from("business_services")
      .select(
        "id, name, description, pricing_type, price_minor, duration_minutes, is_package, package_includes, category_id",
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
  ]);

  for (const result of [services, areas, availability, portfolio, reviews]) {
    if (result.error)
      throw new AppError("INTERNAL", "Could not load this business.", { cause: result.error });
  }

  return {
    ...business,
    services: services.data ?? [],
    areas: areas.data ?? [],
    availability: availability.data ?? [],
    portfolio: portfolio.data ?? [],
    reviews: reviews.data ?? [],
  };
});

export type BusinessProfile = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;
export type BusinessService = BusinessProfile["services"][number];
