import "server-only";

import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export type NewNotification = { userId: string; type: string; title: string; body?: string; data?: Json };

/** In-app notifications. Best-effort: a failed notification never fails the action that caused it. */
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
