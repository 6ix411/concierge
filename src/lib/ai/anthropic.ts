import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors";

let client: Anthropic | undefined;

/**
 * Anthropic client for the AI Concierge. Server-only: the API key never reaches the browser.
 *
 * Platform rules the concierge must follow (enforced in later stages):
 * - It only matches customers with businesses registered AND approved on this platform. No web search.
 * - It never takes part in customer–business chat (no replies, suggestions, summaries or negotiation).
 */
export function getAnthropic(): Anthropic {
  const apiKey = getServerEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AppError("INTERNAL", "The AI Concierge is not configured.");
  client ??= new Anthropic({ apiKey });
  return client;
}

export function getConciergeModel(): string {
  return getServerEnv().ANTHROPIC_MODEL;
}
