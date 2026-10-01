import "server-only";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

import { meaningfulQuery, resolvePlace, type Place } from "./request";
import type { Match, MatchSort } from "./types";

export type MatchFilters = {
  query?: string | null;
  /** Category slug; its sub-categories are included. */
  category?: string | null;
  /** A resolved place, or whatever the customer typed ("vi", "Lekki", "Abuja"). */
  location?: Place | string | null;
  /** YYYY-MM-DD in Lagos time. */
  date?: string | null;
  /** HH:MM. */
  time?: string | null;
  guests?: number | null;
  /** Ranks businesses by price against it, without hiding anyone. */
  budgetMinor?: number | null;
  /** Hides businesses that only list prices above it. */
  maxPriceMinor?: number | null;
  sort?: MatchSort;
  /** Only these businesses (still subject to the eligibility rules). */
  ids?: string[] | null;
  limit?: number;
  offset?: number;
};

function placeArgs(location: MatchFilters["location"]) {
  if (!location) return {};
  const place = typeof location === "string" ? resolvePlace(location) : location;
  // A place we don't know is matched against service areas and cities by name.
  if (!place) return { p_area: String(location).trim().slice(0, 80) || undefined };
  return { p_area: place.area ?? undefined, p_city: place.city ?? undefined, p_state: place.state };
}

/**
 * The marketplace search. Every result comes from `match_businesses`, which only returns businesses
 * registered on Concierge that pass the platform's eligibility rules (approved, verified, accepting
 * bookings, active owner, at least one service). Nothing is ever looked up outside the platform.
 */
export async function findMatches(filters: MatchFilters): Promise<Match[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("match_businesses", {
    p_query: meaningfulQuery(filters.query) ?? undefined,
    p_category: filters.category || undefined,
    ...placeArgs(filters.location),
    p_date: filters.date ?? undefined,
    p_time: filters.time ?? undefined,
    p_guests: filters.guests ?? undefined,
    p_budget_minor: filters.budgetMinor ?? undefined,
    p_max_price_minor: filters.maxPriceMinor ?? undefined,
    p_sort: filters.sort ?? "match",
    p_limit: filters.limit ?? 20,
    p_offset: filters.offset ?? 0,
    p_ids: filters.ids ?? undefined,
  });
  if (error) throw new AppError("INTERNAL", "Search is unavailable right now.", { cause: error });
  return (data ?? []) as Match[];
}
