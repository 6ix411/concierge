import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getServerEnv } from "@/lib/env/server";

let client: Anthropic | undefined;

/**
 * Anthropic client for the AI Concierge. Server-only: the API key never reaches the browser.
 *
 * Platform rules the concierge must follow (enforced in later stages):
 * - It only matches customers with businesses registered AND approved on this platform. No web search.
 * - It never takes part in customer–business chat (no replies, suggestions, summaries or negotiation).
 */
export function getAnthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: getServerEnv().ANTHROPIC_API_KEY });
  return client;
}

export function getConciergeModel(): string {
  return getServerEnv().ANTHROPIC_MODEL;
}
