/**
 * Replies built straight from database results, with no model involved. Used by the built-in
 * concierge, and as the safe answer when a model's reply can't be verified.
 */

import { explainMatch, isFullMatch } from "@/lib/matching/explain";
import type { Match } from "@/lib/matching/types";

import { NO_PROVIDER_MESSAGE, type ReplyDraft, type Requirements } from "./types";

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function composeResults(matches: Match[], requirements: Requirements | null): ReplyDraft {
  const empty: ReplyDraft = {
    message: NO_PROVIDER_MESSAGE,
    providerIds: [],
    compare: false,
    booking: null,
    suggestions: [],
  };
  if (matches.length === 0) return empty;

  const full = matches.filter(isFullMatch).slice(0, 6);
  const close = matches.filter((match) => !isFullMatch(match)).slice(0, 3);
  const needs = {
    location: requirements?.location ?? null,
    date: requirements?.date ?? null,
    time: requirements?.time ?? null,
    guests: requirements?.guests ?? null,
    budgetMinor: requirements?.budgetMinor ?? null,
  };

  if (full.length === 0) {
    return {
      ...empty,
      message: `${NO_PROVIDER_MESSAGE} These registered providers come close, but each misses something you asked for, as shown on each card.`,
      providerIds: close.map((match) => match.id),
      suggestions: ["Try a different date", "Increase my budget"],
    };
  }

  const best = full[0]!;
  const highlights = explainMatch(best, needs)
    .filter((reason) => reason.met && ["location", "availability", "price", "guests"].includes(reason.kind))
    .slice(0, 3)
    .map((reason) =>
      reason.kind === "price" ? reason.text : reason.text.charAt(0).toLowerCase() + reason.text.slice(1),
    );
  const intro =
    full.length === 1
      ? `I found one verified provider on Concierge that fits: ${best.name}.`
      : `I found ${full.length} verified providers on Concierge that fit: ${list(full.map((match) => match.name))}.`;
  const why = highlights.length > 0 ? ` ${best.name} is the strongest match: ${list(highlights)}.` : "";
  const extra =
    close.length > 0 ? " I’ve also listed a few close options that miss something you asked for." : "";

  return {
    message: `${intro}${why}${extra} Tap Book to start a booking, or tick Compare to see them side by side.`,
    providerIds: [...full, ...close].map((match) => match.id),
    compare: false,
    booking: null,
    suggestions: full.length > 1 ? [`Compare the top ${Math.min(full.length, 3)}`] : [],
  };
}
