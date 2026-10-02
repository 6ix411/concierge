/**
 * The concierge's tools. They are the only way it learns anything about providers, and they only
 * read businesses registered on Concierge through the matching engine's eligibility rules. There
 * is no web search and no tool that creates bookings or payments.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { formatNaira, formatPriceRange, formatTime, weekdayNames } from "@/lib/format";
import type { MatchFilters } from "@/lib/matching/engine";
import { resolvePlace } from "@/lib/matching/request";
import type { Match } from "@/lib/matching/types";

import type { Facts } from "./facts";
import type { Requirements } from "./types";

/** One provider's structured details, as `concierge_provider_details` returns them. */
export const providerDetailsSchema = z.object({
  description: z.string().nullable(),
  min_notice_hours: z.number().nullable(),
  booking_window_days: z.number().nullable(),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      pricing_type: z.string(),
      price_minor: z.number().nullable(),
      duration_minutes: z.number().nullable(),
      is_addon: z.boolean(),
      package_includes: z.array(z.string()).nullable(),
    }),
  ),
  areas: z.array(z.object({ area: z.string().nullable(), city: z.string().nullable(), state: z.string() })),
  weekly_hours: z.array(z.object({ day_of_week: z.number(), start_time: z.string(), end_time: z.string() })),
  reviews: z.array(z.object({ rating: z.number(), comment: z.string().nullable(), by: z.string() })),
});
export type ProviderDetails = z.infer<typeof providerDetailsSchema>;

/**
 * Everything the concierge can read. Both functions return structured data about eligible
 * businesses only (see `concierge_provider_details` and `match_businesses`); the model never
 * writes a query.
 */
export type DataSource = {
  findMatches(filters: MatchFilters): Promise<Match[]>;
  getDetails(providerId: string): Promise<ProviderDetails | null>;
  categories: { slug: string; label: string }[];
  /** Today in Lagos, YYYY-MM-DD. */
  today: string;
};

export type ToolContext = { data: DataSource; facts: Facts };

const SEARCH_LIMIT = 8;

// ---------------------------------------------------------------------------
// Inputs (the model's arguments are checked like any other untrusted input)
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const naira = z.number().positive().max(1_000_000_000);

const searchInput = z.object({
  service_query: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  event: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
  date: isoDate.optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
    .optional(),
  guests: z.number().int().positive().max(100_000).optional(),
  budget_naira: naira.optional(),
  sort: z.enum(["match", "rating", "price_low", "price_high"]).optional(),
});

const detailsInput = z.object({ provider_id: z.guid(), date: isoDate.optional() });

const compareInput = z.object({
  provider_ids: z.array(z.guid()).min(2).max(4),
  service_query: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
  date: isoDate.optional(),
  guests: z.number().int().positive().max(100_000).optional(),
  budget_naira: naira.optional(),
});

export const replyInput = z.object({
  message: z.string().trim().min(1).max(2000),
  provider_ids: z.array(z.guid()).max(6).optional(),
  compare: z.boolean().optional(),
  booking: z
    .object({
      provider_id: z.guid(),
      service_ids: z.array(z.guid()).max(5).optional(),
      date: isoDate.optional(),
    })
    .optional(),
  suggested_replies: z.array(z.string().trim().min(1).max(80)).max(4).optional(),
});

// ---------------------------------------------------------------------------
// Definitions sent to the model
// ---------------------------------------------------------------------------

export const REPLY_TOOL = "reply_to_customer";

export function toolDefinitions(categories: DataSource["categories"]): Anthropic.Messages.Tool[] {
  return [
    {
      name: "search_providers",
      description:
        "Search businesses registered and approved on Concierge. This is the only source of providers. Returns ranked providers with their real prices, service areas, availability on the date (when given), group capacity, ratings and completed bookings. Pass everything the customer has told you.",
      input_schema: {
        type: "object",
        properties: {
          service_query: {
            type: "string",
            description: "What they need in their own words, e.g. 'birthday photographer'.",
          },
          category: {
            type: "string",
            enum: categories.map((c) => c.slug),
            description: "Category slug when clear.",
          },
          event: { type: "string", description: "The occasion, e.g. 'Birthday', 'Wedding'." },
          location: {
            type: "string",
            description: "Area, city or state, e.g. 'Victoria Island', 'Lekki', 'Abuja'.",
          },
          date: { type: "string", description: "YYYY-MM-DD in Lagos time." },
          time: { type: "string", description: "HH:MM, 24-hour." },
          guests: { type: "integer" },
          budget_naira: { type: "number", description: "Budget in naira (not kobo)." },
          sort: { type: "string", enum: ["match", "rating", "price_low", "price_high"] },
        },
      },
    },
    {
      name: "get_provider_details",
      description:
        "Full details of one provider returned by search: every service with its real price, add-ons, service areas, working hours, notice period and recent reviews. Pass a date to check availability that day.",
      input_schema: {
        type: "object",
        properties: { provider_id: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" } },
        required: ["provider_id"],
      },
    },
    {
      name: "compare_providers",
      description:
        "Compare 2 to 4 providers side by side against the customer's needs (price, availability, area, capacity, rating, completed bookings).",
      input_schema: {
        type: "object",
        properties: {
          provider_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
          service_query: {
            type: "string",
            description: "The service being compared, so prices refer to the matching services.",
          },
          category: { type: "string", enum: categories.map((c) => c.slug) },
          location: { type: "string" },
          date: { type: "string" },
          guests: { type: "integer" },
          budget_naira: { type: "number" },
        },
        required: ["provider_ids"],
      },
    },
    {
      name: REPLY_TOOL,
      description:
        "Send your reply to the customer. Always finish with this tool. Providers listed in provider_ids are shown as cards with their real details from the database.",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Plain text, short and friendly. No markdown tables." },
          provider_ids: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
            description:
              "Providers to show, best first. Only ids returned by a tool in this conversation turn.",
          },
          compare: { type: "boolean", description: "Show the listed providers side by side." },
          booking: {
            type: "object",
            description:
              "Offer a button that opens the booking form for this provider. It does not book anything: the customer completes and pays for the booking themselves.",
            properties: {
              provider_id: { type: "string" },
              service_ids: { type: "array", items: { type: "string" } },
              date: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["provider_id"],
          },
          suggested_replies: {
            type: "array",
            items: { type: "string" },
            maxItems: 4,
            description: "Short answers the customer can tap, e.g. options for a clarifying question.",
          },
        },
        required: ["message"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ToolOutput = { content: unknown; isError?: boolean };

/**
 * Text written by businesses or customers (descriptions, reviews) reaches the model as quoted data:
 * shortened, on one line, without control or invisible characters, and labelled so it can't pass
 * for instructions (the system prompt says to treat it as information only).
 */
export function untrusted(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const clean = text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return clean ? `«${clean.replace(/[«»]/g, '"')}»` : null;
}

const errorOutput = (message: string): ToolOutput => ({ content: { error: message }, isError: true });

function describePrice(match: Match) {
  if (match.min_price_minor !== null) return formatPriceRange(match.min_price_minor, match.max_price_minor);
  return match.has_quote_only ? "price on request" : null;
}

function summarise(match: Match) {
  return {
    provider_id: match.id,
    name: match.name,
    category: match.category_name,
    price_range: describePrice(match),
    matching_services: match.matched_services,
    service_areas: match.served_areas,
    based_in: [match.city, match.state].filter(Boolean).join(", "),
    location_fit: match.location_match ?? "not asked",
    availability: match.availability === "unknown" ? "not checked (no date given)" : match.availability,
    availability_note: match.availability_note,
    within_budget: match.within_budget,
    guest_capacity: match.guest_capacity,
    fits_guests: match.fits_guests,
    rating:
      match.rating_count > 0
        ? `${Number(match.rating_avg).toFixed(1)} from ${match.rating_count} review${match.rating_count === 1 ? "" : "s"}`
        : "no reviews yet",
    completed_bookings: match.completed_bookings,
    verified: match.is_verified,
    match_score: match.score,
  };
}

function requirementsFrom(
  input: z.infer<typeof searchInput>,
  categories: DataSource["categories"],
): Requirements {
  const category = input.category ? (categories.find((c) => c.slug === input.category) ?? null) : null;
  return {
    query: input.service_query || null,
    category,
    event: input.event || null,
    location: input.location ? (resolvePlace(input.location)?.label ?? input.location) : null,
    date: input.date ?? null,
    time: input.time ?? null,
    guests: input.guests ?? null,
    budgetMinor: input.budget_naira ? Math.round(input.budget_naira * 100) : null,
  };
}

function checkDate(date: string | undefined, today: string): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return "That date doesn't exist.";
  if (date < today) return `That date is in the past (today is ${today}).`;
  return null;
}

async function searchProviders(raw: unknown, { data, facts }: ToolContext): Promise<ToolOutput> {
  const parsed = searchInput.safeParse(raw);
  if (!parsed.success) return errorOutput(z.prettifyError(parsed.error));
  const input = parsed.data;
  const dateProblem = checkDate(input.date, data.today);
  if (dateProblem) return errorOutput(dateProblem);
  if (input.category && !data.categories.some((c) => c.slug === input.category))
    return errorOutput("Unknown category. Use one of the listed slugs, or leave it out.");

  const requirements = requirementsFrom(input, data.categories);
  const matches = await data.findMatches({
    query: [input.service_query, input.event].filter(Boolean).join(" ") || null,
    category: input.category ?? null,
    location: input.location ?? null,
    date: requirements.date,
    time: requirements.time,
    guests: requirements.guests,
    budgetMinor: requirements.budgetMinor,
    sort: input.sort ?? "match",
    limit: SEARCH_LIMIT,
  });
  facts.addSearch(requirements, matches);

  return {
    content: {
      providers: matches.map(summarise),
      note:
        matches.length === 0
          ? "No registered provider matches these requirements. Do not suggest any other business."
          : "Only these providers exist for this search. Providers with availability 'unavailable', within_budget false, fits_guests false or location_fit 'nearby' miss something the customer asked for: say so.",
    },
  };
}

async function providerDetails(raw: unknown, { data, facts }: ToolContext): Promise<ToolOutput> {
  const parsed = detailsInput.safeParse(raw);
  if (!parsed.success) return errorOutput(z.prettifyError(parsed.error));
  const { provider_id, date } = parsed.data;
  const dateProblem = checkDate(date, data.today);
  if (dateProblem) return errorOutput(dateProblem);

  const [match] = await data.findMatches({ ids: [provider_id], date: date ?? null, limit: 1 });
  if (!match) return errorOutput("This provider isn't available on Concierge. Don't recommend it.");
  const profile = await data.getDetails(match.id);
  if (!profile) return errorOutput("This provider isn't available on Concierge. Don't recommend it.");

  facts.addMatch(match, date ?? null);
  const fact = facts.provider(match);
  for (const service of profile.services) {
    fact.services.set(service.id, {
      id: service.id,
      name: service.name,
      priceMinor: service.price_minor,
      isAddon: service.is_addon,
    });
    if (service.price_minor !== null) fact.prices.add(service.price_minor);
  }
  const reviews = profile.reviews.slice(0, 5);
  for (const review of reviews) fact.reviewRatings.add(review.rating);

  const hours = profile.weekly_hours.map(
    (rule) => `${weekdayNames[rule.day_of_week]} ${formatTime(rule.start_time)}–${formatTime(rule.end_time)}`,
  );

  return {
    content: {
      ...summarise(match),
      description: untrusted(profile.description, 600),
      services: profile.services.map((service) => ({
        service_id: service.id,
        name: service.name,
        description: untrusted(service.description, 300),
        price:
          service.pricing_type === "quote_only" || service.price_minor === null
            ? "price on request"
            : `${service.pricing_type === "starting_from" ? "from " : ""}${formatNaira(service.price_minor)}${service.pricing_type === "hourly" ? " per hour" : ""}`,
        duration_minutes: service.duration_minutes,
        add_on: service.is_addon,
        package_includes: (service.package_includes ?? []).map((item) => untrusted(item, 120)),
      })),
      service_areas: profile.areas.map((area) =>
        [area.area, area.city, area.state].filter(Boolean).join(", "),
      ),
      weekly_hours: hours,
      minimum_notice_hours: profile.min_notice_hours,
      books_up_to_days_ahead: profile.booking_window_days,
      recent_reviews: reviews.map((review) => ({
        rating: review.rating,
        comment: untrusted(review.comment, 300),
        by: review.by,
      })),
    },
  };
}

async function compareProviders(raw: unknown, { data, facts }: ToolContext): Promise<ToolOutput> {
  const parsed = compareInput.safeParse(raw);
  if (!parsed.success) return errorOutput(z.prettifyError(parsed.error));
  const input = parsed.data;
  const dateProblem = checkDate(input.date, data.today);
  if (dateProblem) return errorOutput(dateProblem);

  const matches = await data.findMatches({
    ids: input.provider_ids,
    query: input.service_query ?? null,
    category:
      input.category && data.categories.some((c) => c.slug === input.category) ? input.category : null,
    location: input.location ?? null,
    date: input.date ?? null,
    guests: input.guests ?? null,
    budgetMinor: input.budget_naira ? Math.round(input.budget_naira * 100) : null,
    limit: 4,
  });
  for (const match of matches) facts.addMatch(match, input.date ?? null);
  const missing = input.provider_ids.filter((id) => !matches.some((match) => match.id === id));
  return {
    content: {
      providers: matches.map(summarise),
      not_returned: missing,
      note:
        missing.length > 0
          ? "Providers in not_returned are no longer bookable on Concierge or don't offer this service. Don't recommend them for it."
          : undefined,
    },
  };
}

export async function executeTool(name: string, input: unknown, context: ToolContext): Promise<ToolOutput> {
  switch (name) {
    case "search_providers":
      return searchProviders(input, context);
    case "get_provider_details":
      return providerDetails(input, context);
    case "compare_providers":
      return compareProviders(input, context);
    default:
      return errorOutput(`Unknown tool ${name}.`);
  }
}
