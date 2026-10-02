"use server";

import { z } from "zod";

import { getSessionUser } from "@/lib/auth/session";
import { logger } from "@/lib/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";

import { loadHistory, saveTurns } from "./history";
import { answer } from "./service";
import type { ChatTurn, ConciergeReply } from "./types";

const askSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  conversationId: z.guid().nullish(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
        providerIds: z.array(z.guid()).max(6).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export type AskInput = z.input<typeof askSchema>;
export type AskResult =
  { ok: true; reply: ConciergeReply; conversationId: string | null } | { ok: false; error: string };

/**
 * A visitor's history comes from their browser, so it is untrusted: only the latest turns, within
 * a size budget. (Providers are re-checked against the database on every message anyway.)
 */
function visitorHistory(turns: ChatTurn[]): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let budget = 8000;
  for (const turn of turns.slice(-20).reverse()) {
    budget -= turn.content.length;
    if (budget < 0) break;
    kept.unshift(turn);
  }
  return kept;
}

export async function askConciergeAction(input: AskInput): Promise<AskResult> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please type a shorter message." };
  const { message } = parsed.data;

  const user = await getSessionUser();
  if (user && user.status !== "active")
    return { ok: false, error: "Your account can’t use the concierge right now." };

  // Per signed-in user, or per network address for visitors (many people can share one mobile IP).
  const allowed = user
    ? await checkRateLimit("concierge.user", user.id)
    : await checkRateLimit("concierge.visitor");
  if (!allowed)
    return { ok: false, error: "You’re sending messages quickly. Please wait a few minutes and try again." };

  try {
    // Signed-in customers' history comes from the database; visitors' from the page they're on.
    let history: ChatTurn[] = visitorHistory(parsed.data.history ?? []);
    let conversationId = parsed.data.conversationId ?? null;
    if (user) {
      history = conversationId ? ((await loadHistory(conversationId, user.id)) ?? []) : [];
      if (history.length === 0) conversationId = null;
    }

    const { reply, requirements } = await answer(history, message);
    if (user) {
      conversationId = await saveTurns({ userId: user.id, conversationId, message, reply, requirements });
    }
    return { ok: true, reply, conversationId: user ? conversationId : null };
  } catch (error) {
    logger.error("Concierge failed", { error });
    return { ok: false, error: "The concierge is unavailable right now. Please try again." };
  }
}
