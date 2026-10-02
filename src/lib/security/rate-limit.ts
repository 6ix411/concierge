import "server-only";

import { AppError, logger } from "@/lib/errors";
import { rateLimit as localRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

import { logSecurityEvent } from "./events";
import { clientIp } from "./request";

/** How often each action may be used, per person (or per network address for visitors). */
export const rateLimits = {
  "auth.sign_in.ip": { limit: 20, windowSeconds: 10 * 60 },
  "auth.sign_in.email": { limit: 8, windowSeconds: 15 * 60 },
  "auth.sign_up": { limit: 5, windowSeconds: 60 * 60 },
  "auth.password_reset.ip": { limit: 5, windowSeconds: 60 * 60 },
  "auth.password_reset.email": { limit: 3, windowSeconds: 60 * 60 },
  "auth.password_change": { limit: 5, windowSeconds: 15 * 60 },
  "booking.create": { limit: 10, windowSeconds: 60 * 60 },
  "booking.change": { limit: 30, windowSeconds: 60 * 60 },
  "checkout.start": { limit: 20, windowSeconds: 60 * 60 },
  "payment.callback": { limit: 30, windowSeconds: 10 * 60 },
  "payment.webhook": { limit: 300, windowSeconds: 60 },
  "review.submit": { limit: 10, windowSeconds: 60 * 60 },
  "dispute.open": { limit: 5, windowSeconds: 60 * 60 },
  "dispute.message": { limit: 30, windowSeconds: 10 * 60 },
  "chat.attachment": { limit: 30, windowSeconds: 10 * 60 },
  "chat.report": { limit: 20, windowSeconds: 60 * 60 },
  "concierge.user": { limit: 30, windowSeconds: 10 * 60 },
  "concierge.visitor": { limit: 60, windowSeconds: 10 * 60 },
} as const satisfies Record<string, { limit: number; windowSeconds: number }>;

export type RateLimitRule = keyof typeof rateLimits;

/**
 * Counts one use of `rule` by `subject` (a user id, email or network address; defaults to the
 * caller's address) and says whether it is allowed. Counts are kept in the database so every server
 * instance shares them; if the database can't be reached, a per-instance limit applies instead.
 */
export async function checkRateLimit(rule: RateLimitRule, subject?: string | null): Promise<boolean> {
  const { limit, windowSeconds } = rateLimits[rule];
  const who = subject ?? (await clientIp());
  // Without a known address every visitor would share one count and lock each other out. The
  // per-account limits still apply.
  if (who === "unknown") return true;
  const key = `${rule}:${who.toLowerCase()}`;
  let allowed: boolean;
  try {
    const { data, error } = await createAdminClient().rpc("hit_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    allowed = data === true;
  } catch (error) {
    logger.warn("Rate limiter unavailable; using the local limit", { rule, error });
    allowed = localRateLimit(key, limit, windowSeconds * 1000);
  }
  // Record the first refusal in each window, not every one.
  if (!allowed && localRateLimit(`logged:${key}`, 1, windowSeconds * 1000))
    await logSecurityEvent("rate_limited", { details: { rule } });
  return allowed;
}

export const RATE_LIMITED_MESSAGE = "You’re doing that too often. Please wait a few minutes and try again.";

/** For server actions: throws a user-safe "too often" error when the limit is reached. */
export async function enforceRateLimit(rule: RateLimitRule, subject?: string | null): Promise<void> {
  if (!(await checkRateLimit(rule, subject))) throw new AppError("RATE_LIMITED", RATE_LIMITED_MESSAGE);
}
