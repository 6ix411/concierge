import "server-only";

import { searchBusinesses, type SearchResult } from "@/lib/marketplace/queries";
import { formatNairaShort } from "@/lib/format";

import { parseIntent, type ConciergeIntent } from "./intent";

export type Recommendation = SearchResult & { reasons: string[]; withinBudget: boolean | null };

export type ConciergeResult = {
  intent: ConciergeIntent;
  recommendations: Recommendation[];
  /** Filters we had to loosen to find anyone, in plain words. */
  relaxed: string[];
};

/**
 * Matches a request against businesses registered and approved on this platform.
 * It never searches the web: every result comes from `search_businesses`, which only
 * returns approved businesses.
 */
export async function matchProviders(input: string): Promise<ConciergeResult> {
  const intent = parseIntent(input);
  const relaxed: string[] = [];

  const attempts: {
    category: string | null;
    location: string | null;
    query: string | null;
    note?: string;
  }[] = [{ category: intent.categorySlug, location: intent.location, query: intent.keywords || null }];
  if (intent.categorySlug && intent.keywords) {
    attempts.push({ category: intent.categorySlug, location: intent.location, query: null });
  }
  if (intent.location) {
    attempts.push({
      category: intent.categorySlug,
      location: null,
      query: intent.categorySlug ? null : intent.keywords || null,
      note: `No match in ${intent.location} yet, so we widened the area.`,
    });
  }

  let results: SearchResult[] = [];
  for (const attempt of attempts) {
    results = await searchBusinesses({
      query: attempt.query,
      category: attempt.category,
      location: attempt.location,
      limit: 12,
    });
    if (results.length > 0) {
      if (attempt.note) relaxed.push(attempt.note);
      break;
    }
  }

  const recommendations = results
    .map((result) => withReasons(result, intent))
    .sort((a, b) => Number(b.withinBudget !== false) - Number(a.withinBudget !== false))
    .slice(0, 6);

  if (
    intent.budgetMinor &&
    recommendations.length > 0 &&
    recommendations.every((r) => r.withinBudget === false)
  ) {
    relaxed.push(
      `Nobody lists a price within ${formatNairaShort(intent.budgetMinor)}, so here are the closest options.`,
    );
  }

  return { intent, recommendations, relaxed };
}

function withReasons(result: SearchResult, intent: ConciergeIntent): Recommendation {
  const reasons: string[] = [];
  let withinBudget: boolean | null = null;

  if (intent.location) {
    const served = result.served_areas ?? [];
    const match = served.find((area) => area.toLowerCase() === intent.location!.toLowerCase());
    if (match || result.city?.toLowerCase() === intent.location.toLowerCase()) {
      reasons.push(`Serves ${intent.location}`);
    }
  }

  const service = result.matched_services?.[0];
  if (result.min_price_minor !== null) {
    const price = formatNairaShort(result.min_price_minor);
    if (intent.budgetMinor) {
      withinBudget = result.min_price_minor <= intent.budgetMinor;
      reasons.push(
        withinBudget
          ? `${service ?? "Services"} from ${price}, within your ${formatNairaShort(intent.budgetMinor)} budget`
          : `${service ?? "Services"} from ${price}, above your budget`,
      );
    } else {
      reasons.push(`${service ?? "Services"} from ${price}`);
    }
  } else if (service) {
    reasons.push(`Offers ${service} (price on request)`);
  }

  if (intent.guests) {
    const capacity = (result.matched_services ?? [])
      .map((name) => name.match(/up to (\d+) guests/i)?.[1])
      .filter(Boolean)
      .map(Number);
    if (capacity.some((max) => max >= intent.guests!)) reasons.push(`Handles ${intent.guests} guests`);
  }

  if (result.rating_count > 0) {
    reasons.push(
      `Rated ${Number(result.rating_avg).toFixed(1)} from ${result.rating_count} review${result.rating_count === 1 ? "" : "s"}`,
    );
  }
  if (result.is_verified) reasons.push("Verified by our team");

  return { ...result, reasons, withinBudget };
}
