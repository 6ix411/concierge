import "server-only";

import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { clientIp, hashIp } from "./request";

/** Security events worth a record. Admins read them in the dashboard's Security log. */
export const securityEventLabels = {
  "auth.sign_in_failed": "Failed sign-in",
  "auth.password_changed": "Password changed",
  "auth.password_change_failed": "Wrong current password when changing it",
  "auth.password_reset_requested": "Password reset requested",
  "auth.password_reset": "Password reset",
  rate_limited: "Too many requests",
  "upload.rejected": "File refused (not what it claimed to be)",
  "webhook.bad_signature": "Payment webhook with a bad signature",
  "payment.mismatch": "Payment amount or currency didn't match",
  "payment.duplicate": "Second payment for a paid booking (refunded)",
  "concierge.blocked_reply": "AI reply blocked by the guard",
  "role.changed": "Account role changed",
} as const;

export type SecurityEvent = keyof typeof securityEventLabels;

/** Best-effort: a failed log write never fails the request. */
export async function logSecurityEvent(
  event: SecurityEvent,
  options: { userId?: string | null; details?: Record<string, Json | undefined>; ip?: string } = {},
): Promise<void> {
  try {
    const ip = options.ip ?? (await clientIp());
    const { error } = await createAdminClient()
      .from("security_events")
      .insert({
        event,
        user_id: options.userId ?? null,
        ip_hash: ip === "unknown" ? null : hashIp(ip),
        details: (options.details ?? {}) as NonNullable<Json>,
      });
    if (error) throw error;
  } catch (error) {
    logger.warn("Could not record a security event", { event, error });
  }
}
