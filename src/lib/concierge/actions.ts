"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth/session";
import { logger } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

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

// Per signed-in user, or per network address for visitors (many people can share one mobile IP).
const USER_LIMIT = 30;
const VISITOR_LIMIT = 60;
const WINDOW_MS = 10 * 60 * 1000;

export async function askConciergeAction(input: AskInput): Promise<AskResult> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please type a shorter message." };
  const { message } = parsed.data;

  const user = await getSessionUser();
  if (user && user.status !== "active")
    return { ok: false, error: "Your account can’t use the concierge right now." };

  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown";
  if (!rateLimit(`concierge:${user?.id ?? ip}`, user ? USER_LIMIT : VISITOR_LIMIT, WINDOW_MS))
    return { ok: false, error: "You’re sending messages quickly. Please wait a few minutes and try again." };

  try {
    // Signed-in customers' history comes from the database; visitors' from the page they're on.
    let history: ChatTurn[] = (parsed.data.history ?? []).slice(-20);
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
