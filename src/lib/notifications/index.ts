import "server-only";

import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export type NewNotification = {
  userId: string;
  /** "<category>.<event>", e.g. "booking.accepted". The category groups it in the notification centre. */
  type: string;
  title: string;
  body?: string;
  /** Ids the notification points at (bookingId, disputeId, conversationId…); see links.ts. */
  data?: Json;
};

/**
 * In-app notifications. Best-effort: a failed notification never fails the action that caused it.
 * When email, SMS or push are enabled (platform setting "notification_channels"), the database also
 * queues each one for those channels; see channels.ts.
 */
export async function notify(...notifications: NewNotification[]): Promise<void> {
  if (notifications.length === 0) return;
  const { error } = await createAdminClient()
    .from("notifications")
    .insert(
      notifications.map((n) => ({
        user_id: n.userId,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        data: n.data ?? {},
      })),
    );
  if (error) logger.warn("Could not create notifications", { error });
}

/** Every active admin, to notify the Concierge team. */
export async function activeAdminIds(): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("status", "active");
  return (data ?? []).map((a) => a.id);
}
