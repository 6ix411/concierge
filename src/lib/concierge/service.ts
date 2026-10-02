import "server-only";

import { trackSearch } from "@/lib/analytics/track";
import { getAnthropic, getConciergeModel, isAiConfigured } from "@/lib/ai/anthropic";
import { lagosToday } from "@/lib/dates";
import { logger } from "@/lib/errors";
import { formatNaira, formatTime } from "@/lib/format";
import { getCategories } from "@/lib/marketplace/queries";
import { findMatches } from "@/lib/matching/engine";
import { explainMatch, formatRequestDate } from "@/lib/matching/explain";
import { resolvePlace } from "@/lib/matching/request";
import { logSecurityEvent } from "@/lib/security/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";

import { runAgent } from "./agent";
import { Facts } from "./facts";
import { runRules } from "./rules";
import { providerDetailsSchema, type DataSource } from "./tools";
import type {
  BookingLink,
  ChatTurn,
  ConciergeReply,
  Recommendation,
  ReplyDraft,
  Requirements,
} from "./types";

/**
 * The concierge's only access to data: a visitor-level client (no session, whoever is signed in)
 * calling two read-only functions that return structured details of eligible providers.
 */
async function dataSource(): Promise<DataSource> {
  const categories = await getCategories();
  const db = createPublicClient();
  return {
    findMatches: (filters) => findMatches(filters, db),
    async getDetails(providerId) {
      const { data, error } = await db.rpc("concierge_provider_details", { p_business_id: providerId });
      if (error) throw error;
      if (!data) return null;
      return providerDetailsSchema.parse(data);
    },
    categories: categories.flatMap((parent) => [
      { slug: parent.slug, label: parent.name },
      ...parent.children.map((child) => ({ slug: child.slug, label: child.name })),
    ]),
    today: lagosToday(),
  };
}

let namesCache: { names: string[]; at: number } | null = null;

/**
 * Every business name on the platform (approved or not), so replies can't mention one unchecked.
 * Used by the guard only; never sent to the model.
 */
async function knownBusinessNames(): Promise<string[]> {
  if (namesCache && Date.now() - namesCache.at < 60_000) return namesCache.names;
  const { data, error } = await createAdminClient().from("businesses").select("name");
  if (error) throw error;
  namesCache = { names: (data ?? []).map((row) => row.name), at: Date.now() };
  return namesCache.names;
}

/** "Victoria Island" → "Victoria Island, Lagos"; places we don't know stay as typed. */
function placeLabel(text: string): string {
  const place = resolvePlace(text);
  return place?.area && place.city ? `${place.area}, ${place.city}` : text;
}

export function describeRequirements(requirements: Requirements | null): ConciergeReply["understood"] {
  if (!requirements) return [];
  const rows: [string, string | null][] = [
    ["Category", requirements.category?.label ?? null],
    ["Event", requirements.event],
    ["Location", requirements.location ? placeLabel(requirements.location) : null],
    ["Date", requirements.date ? formatRequestDate(requirements.date) : null],
    ["Time", requirements.time ? formatTime(requirements.time) : null],
    ["Guests", requirements.guests ? String(requirements.guests) : null],
    ["Budget", requirements.budgetMinor ? formatNaira(requirements.budgetMinor) : null],
  ];
  return rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([label, value]) => ({ label, value }));
}

function bookingLink(draft: ReplyDraft, facts: Facts, today: string): BookingLink | null {
  if (!draft.booking) return null;
  const provider = facts.providers.get(draft.booking.providerId);
  if (!provider) return null;
  const services = draft.booking.serviceIds
    .map((id) => provider.services.get(id))
    .filter((service) => service !== undefined);
  const date = draft.booking.date && draft.booking.date >= today ? draft.booking.date : null;
  const params = new URLSearchParams();
  for (const service of services) params.append("service", service.id);
  if (date) params.set("date", date);
  const query = params.toString();
  return {
    href: `/book/${provider.slug}${query ? `?${query}` : ""}`,
    businessName: provider.name,
    services: services.map((service) => service.name),
    date,
  };
}

/** Cards for the reply, straight from the database rows the tools returned. */
export function recommendationsFor(
  ids: string[],
  facts: Facts,
  requirements: Requirements | null,
): Recommendation[] {
  const needs = {
    location: requirements?.location ?? null,
    date: requirements?.date ?? null,
    time: requirements?.time ?? null,
    guests: requirements?.guests ?? null,
    budgetMinor: requirements?.budgetMinor ?? null,
  };
  return ids
    .map((id) => facts.matches.get(id))
    .filter((match) => match !== undefined)
    .map((match) => ({ ...match, reasons: explainMatch(match, needs) }));
}

/** Answers one customer message. Only registered, eligible businesses can ever be shown. */
export async function answer(
  history: ChatTurn[],
  message: string,
): Promise<{ reply: ConciergeReply; requirements: Requirements | null }> {
  const data = await dataSource();
  let result: { draft: ReplyDraft; facts: Facts } | null = null;
  let source: ConciergeReply["source"] = "rules";

  if (isAiConfigured()) {
    try {
      const run = await runAgent({
        client: getAnthropic(),
        model: getConciergeModel(),
        data,
        history,
        message,
        knownBusinessNames: await knownBusinessNames(),
      });
      // The model's reply failed the guard every time; the customer got a reply built from the
      // database instead. Recorded so repeated attempts to steer the AI show up in the log.
      if (!run.verified) await logSecurityEvent("concierge.blocked_reply");
      result = run;
      source = "ai";
    } catch (error) {
      logger.warn("AI concierge unavailable; using built-in rules", { error });
    }
  }
  result ??= await runRules({ data, history, message });

  const { draft, facts } = result;
  const requirements = facts.lastRequirements;
  // One search per customer message, however many lookups it took: the last one is what they saw.
  const search = facts.searches.at(-1);
  if (search)
    await trackSearch({
      source: "concierge",
      categorySlug: search.requirements.category?.slug,
      location: search.requirements.location,
      businessIds: search.matchIds,
    });
  return {
    reply: {
      message: draft.message,
      providers: recommendationsFor(draft.providerIds, facts, requirements),
      compare: draft.compare,
      booking: bookingLink(draft, facts, data.today),
      suggestions: draft.suggestions,
      understood: describeRequirements(requirements),
      source,
    },
    requirements,
  };
}

/** Rebuilds cards for a saved reply from today's data (prices and availability may have changed). */
export async function refreshProviders(
  ids: string[],
  requirements: Requirements | null,
): Promise<Recommendation[]> {
  if (ids.length === 0) return [];
  const matches = await findMatches({
    ids,
    category: null,
    location: requirements?.location ?? null,
    date: requirements?.date && requirements.date >= lagosToday() ? requirements.date : null,
    time: requirements?.time ?? null,
    guests: requirements?.guests ?? null,
    budgetMinor: requirements?.budgetMinor ?? null,
    limit: ids.length,
  });
  const byId = new Map(matches.map((match) => [match.id, match]));
  const facts = new Facts();
  for (const id of ids) {
    const match = byId.get(id);
    if (match) facts.addMatch(match, null);
  }
  return recommendationsFor(ids, facts, requirements);
}
