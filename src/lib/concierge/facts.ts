/**
 * Everything the concierge learned from the database while answering one message. Replies are
 * checked against these facts, so the concierge can only mention what the platform returned.
 */

import { isFullMatch } from "@/lib/matching/explain";
import type { Match } from "@/lib/matching/types";

import type { Requirements } from "./types";

export type ServiceFact = { id: string; name: string; priceMinor: number | null; isAddon: boolean };

export type ProviderFact = {
  id: string;
  name: string;
  slug: string;
  /** Every price the database gave for this provider, in kobo. */
  prices: Set<number>;
  services: Map<string, ServiceFact>;
  ratingAvg: number;
  ratingCount: number;
  /** Review scores the concierge was shown. */
  reviewRatings: Set<number>;
};

export class Facts {
  readonly providers = new Map<string, ProviderFact>();
  /** The latest search row per provider, used for the cards. */
  readonly matches = new Map<string, Match>();
  readonly searches: {
    requirements: Requirements;
    resultCount: number;
    fullMatches: number;
    matchIds: string[];
  }[] = [];
  /** Dates the concierge checked availability for. */
  readonly datesChecked = new Set<string>();
  lastRequirements: Requirements | null = null;

  provider(match: Pick<Match, "id" | "name" | "slug" | "rating_avg" | "rating_count">): ProviderFact {
    let fact = this.providers.get(match.id);
    if (!fact) {
      fact = {
        id: match.id,
        name: match.name,
        slug: match.slug,
        prices: new Set(),
        services: new Map(),
        ratingAvg: Number(match.rating_avg),
        ratingCount: match.rating_count,
        reviewRatings: new Set(),
      };
      this.providers.set(match.id, fact);
    }
    return fact;
  }

  addMatch(match: Match, date: string | null) {
    const fact = this.provider(match);
    if (match.min_price_minor !== null) fact.prices.add(match.min_price_minor);
    if (match.max_price_minor !== null) fact.prices.add(match.max_price_minor);
    this.matches.set(match.id, match);
    if (date) this.datesChecked.add(date);
  }

  addSearch(requirements: Requirements, matches: Match[]) {
    this.searches.push({
      requirements,
      resultCount: matches.length,
      fullMatches: matches.filter(isFullMatch).length,
      matchIds: matches.map((match) => match.id),
    });
    this.lastRequirements = requirements;
    for (const match of matches) this.addMatch(match, requirements.date);
  }

  /** True when every search came back empty. */
  get nothingFound(): boolean {
    return this.searches.length > 0 && this.searches.every((search) => search.resultCount === 0);
  }

  /** True when the latest search found nobody who meets every need (only close options, or no one). */
  get nothingSuitable(): boolean {
    const last = this.searches.at(-1);
    return last !== undefined && last.fullMatches === 0;
  }
}
