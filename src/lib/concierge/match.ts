import "server-only";

import { explainMatch, isFullMatch, type Reason } from "@/lib/matching/explain";
import { findMatches } from "@/lib/matching/engine";
import { parseServiceRequest, type ServiceRequest } from "@/lib/matching/request";
import type { Match } from "@/lib/matching/types";

export type Recommendation = Match & { reasons: Reason[] };

export type ConciergeResult = {
  request: ServiceRequest;
  /** Businesses that meet everything we know the customer needs, best first. */
  recommendations: Recommendation[];
  /** Close options that miss something (another area, the date, the budget or the group size). */
  alternatives: Recommendation[];
  /** Anything we had to loosen, in plain words. */
  notes: string[];
};

/**
 * Turns a request into structured details, then matches it against businesses registered and
 * approved on this platform. It never searches the web: every result comes from `findMatches`.
 */
export async function matchProviders(input: string, now: Date = new Date()): Promise<ConciergeResult> {
  const request = parseServiceRequest(input, now);
  const notes: string[] = [];
  const filters = {
    query: request.keywords || null,
    category: request.category?.slug ?? null,
    location: request.location,
    date: request.date,
    time: request.time,
    guests: request.guests,
    budgetMinor: request.budgetMinor,
    limit: 20,
  };

  let matches = await findMatches(filters);
  if (matches.length === 0 && request.location) {
    matches = await findMatches({ ...filters, location: null });
    if (matches.length > 0)
      notes.push(
        `Nobody on Concierge covers ${request.location.label} for this yet, so these work elsewhere.`,
      );
  }

  const explained = matches.map((match) => ({
    ...match,
    reasons: explainMatch(match, { ...request, location: request.location }),
  }));
  const recommendations = explained.filter(isFullMatch).slice(0, 6);
  const alternatives = explained.filter((match) => !isFullMatch(match)).slice(0, 4);

  return { request, recommendations, alternatives, notes };
}
