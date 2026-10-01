/**
 * The built-in concierge, used when no AI key is configured or the AI service is unavailable.
 * It reads requests with rules, asks for what's missing, and answers only from database results,
 * using the same tools and checks as the AI concierge.
 */

import { parseServiceRequest, type ServiceRequest } from "@/lib/matching/request";

import { composeResults } from "./compose";
import { Facts } from "./facts";
import { enforceNoProvider } from "./guard";
import { executeTool, type DataSource } from "./tools";
import { NO_PROVIDER_MESSAGE, type ChatTurn, type ReplyDraft } from "./types";

const ASK_SERVICE = "What service do you need? For example a photographer, caterer, decorator or cleaner.";
const ASK_LOCATION = "Where do you need it? Tell me the area or city, for example Lekki or Ikeja.";

/** Later messages fill in or override what earlier ones said. */
export function mergeRequests(messages: string[], now: Date): ServiceRequest {
  const parsed = messages.map((message) => parseServiceRequest(message, now));
  const latest = parsed.at(-1)!;
  const pick = <K extends keyof ServiceRequest>(key: K) =>
    [...parsed].reverse().find((request) => request[key] !== null && request[key] !== "")?.[key] ??
    latest[key];
  return {
    query: messages.join(" "),
    category: pick("category"),
    event: pick("event"),
    location: pick("location"),
    date: pick("date"),
    time: pick("time"),
    guests: pick("guests"),
    budgetMinor: pick("budgetMinor"),
    keywords: parsed
      .map((request) => request.keywords)
      .join(" ")
      .trim(),
  };
}

const ask = (message: string, suggestions: string[]): ReplyDraft => ({
  message,
  providerIds: [],
  compare: false,
  booking: null,
  suggestions,
});

export async function runRules(input: {
  data: DataSource;
  history: ChatTurn[];
  message: string;
  now?: Date;
}): Promise<{ draft: ReplyDraft; facts: Facts }> {
  const facts = new Facts();
  const context = { data: input.data, facts };
  const now = input.now ?? new Date();
  const lastShown = [...input.history]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.providerIds?.length);

  // "Compare the top 3" after a list of providers.
  if (/\bcompare\b/i.test(input.message) && lastShown?.providerIds && lastShown.providerIds.length >= 2) {
    const ids = lastShown.providerIds.slice(0, 3);
    const request = mergeRequests(
      input.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
      now,
    );
    await executeTool(
      "compare_providers",
      {
        provider_ids: ids,
        service_query: request.event?.label,
        category: request.category?.slug,
        location: request.location?.label,
        date: request.date ?? undefined,
        guests: request.guests ?? undefined,
        budget_naira: request.budgetMinor ? request.budgetMinor / 100 : undefined,
      },
      context,
    );
    const shown = ids.filter((id) => facts.matches.has(id));
    if (shown.length >= 2) {
      return {
        draft: {
          message: "Here they are side by side. Everything shown comes from their Concierge listings.",
          providerIds: shown,
          compare: true,
          booking: null,
          suggestions: [],
        },
        facts,
      };
    }
  }

  const userMessages = [
    ...input.history.filter((turn) => turn.role === "user").map((t) => t.content),
    input.message,
  ];
  const request = mergeRequests(userMessages, now);
  const askedLocation = input.history.some(
    (turn) => turn.role === "assistant" && turn.content === ASK_LOCATION,
  );

  if (
    /^\s*(hi|hello|hey|good (morning|afternoon|evening))\b[\s!.]*$/i.test(input.message) &&
    !request.category
  ) {
    return {
      draft: ask(
        `Hello! ${ASK_SERVICE}`,
        input.data.categories.slice(0, 4).map((c) => c.label),
      ),
      facts,
    };
  }
  if (request.category && !request.location && !askedLocation) {
    return { draft: ask(ASK_LOCATION, ["Lekki", "Victoria Island", "Ikeja", "Abuja"]), facts };
  }

  await executeTool(
    "search_providers",
    {
      service_query: request.category ? request.event?.label : request.keywords || undefined,
      category: request.category?.slug,
      event: request.event?.label,
      location: request.location?.label,
      date: request.date ?? undefined,
      time: request.time ?? undefined,
      guests: request.guests ?? undefined,
      budget_naira: request.budgetMinor ? request.budgetMinor / 100 : undefined,
    },
    context,
  );
  const matches = [...facts.matches.values()];

  if (matches.length === 0 && !request.category) {
    return {
      draft: ask(
        `${NO_PROVIDER_MESSAGE} If I misunderstood, tell me which kind of service you need.`,
        input.data.categories.slice(0, 4).map((c) => c.label),
      ),
      facts,
    };
  }

  return { draft: enforceNoProvider(composeResults(matches, facts.lastRequirements), facts), facts };
}
