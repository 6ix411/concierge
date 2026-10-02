import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";

import { logger } from "@/lib/errors";
import { resolvePlace, type Place } from "@/lib/matching/request";
import { createAdminClient } from "@/lib/supabase/admin";

import { isLikelyBot } from "./rules";

/**
 * Anonymous usage events: searches, the providers each search showed, and profile views. Nothing
 * here identifies a person; see the migration `analytics` for what is stored. Recording happens
 * after the response is sent and never fails the request.
 */

type SearchEvent = {
  source: "search" | "concierge";
  categorySlug?: string | null;
  location?: Place | string | null;
  /** The providers the search showed, in order. */
  businessIds: string[];
};

async function fromRealVisitor(): Promise<boolean> {
  try {
    return !isLikelyBot((await headers()).get("user-agent"));
  } catch {
    return false;
  }
}

/** Only places the platform recognises are kept; free text the customer typed is not. */
function knownPlace(location: SearchEvent["location"]) {
  if (!location) return null;
  const place = typeof location === "string" ? resolvePlace(location) : location;
  return place ? { state: place.state, city: place.city } : null;
}

async function categoryId(slug: string | null | undefined) {
  if (!slug) return null;
  const { data } = await createAdminClient()
    .from("service_categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

async function insertSearch(event: SearchEvent) {
  const place = knownPlace(event.location);
  const category_id = await categoryId(event.categorySlug);
  const shared = {
    source: event.source,
    category_id,
    state: place?.state ?? null,
    city: place?.city ?? null,
  };
  const ids = [...new Set(event.businessIds)];
  const { error } = await createAdminClient()
    .from("analytics_events")
    .insert([
      { ...shared, event_type: "search" as const, result_count: ids.length },
      ...ids.map((business_id) => ({ ...shared, event_type: "provider_match" as const, business_id })),
    ]);
  if (error) throw error;
}

/** Records a search and the providers it showed, once the response has been sent. */
export async function trackSearch(event: SearchEvent): Promise<void> {
  if (!(await fromRealVisitor())) return;
  after(async () => {
    try {
      await insertSearch(event);
    } catch (error) {
      logger.warn("Could not record a search", { error });
    }
  });
}

/** Records one view of an approved business's profile. */
export async function recordProfileView(businessId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("analytics_events")
    .insert({ event_type: "profile_view", source: "profile", business_id: businessId });
  if (error) logger.warn("Could not record a profile view", { error });
}

export { fromRealVisitor };
