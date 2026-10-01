import "server-only";

import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email, SMS and push are added one channel at a time. Each is an adapter that sends one
 * notification to one person. While a channel is listed in the "notification_channels" platform
 * setting, the database queues every new notification for it in `notification_deliveries`, and
 * `dispatchDeliveries` sends what's queued through the matching adapter.
 *
 * To add a channel: write an adapter (e.g. email through a provider's API, with its key in an
 * environment variable), register it in `adapters` below, then add the channel to the setting.
 */
export type ChannelName = "email" | "sms" | "push";

export type Recipient = { id: string; email: string | null; phone: string | null; fullName: string | null };
export type OutgoingNotification = { id: string; type: string; title: string; body: string | null };

export interface NotificationChannel {
  name: ChannelName;
  /** Throws on failure; the delivery is retried on the next run, up to MAX_ATTEMPTS. */
  send(notification: OutgoingNotification, recipient: Recipient): Promise<void>;
}

/** No channel besides in-app is live yet. */
export const adapters: Partial<Record<ChannelName, NotificationChannel>> = {};

const MAX_ATTEMPTS = 5;

/** Sends queued deliveries. Run on a schedule (see /api/notifications/dispatch). */
export async function dispatchDeliveries(
  registry: Partial<Record<ChannelName, NotificationChannel>> = adapters,
  limit = 100,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const db = createAdminClient();
  const { data: queued, error } = await db
    .from("notification_deliveries")
    .select(
      "id, channel, attempts, notification:notifications(id, type, title, body, user:users(id, email, phone, full_name))",
    )
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);
  if (error) throw error;

  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const delivery of queued ?? []) {
    const adapter = registry[delivery.channel as ChannelName];
    const notification = delivery.notification;
    const user = notification?.user;
    if (!adapter || !notification || !user) {
      await db
        .from("notification_deliveries")
        .update({ status: "skipped", last_error: adapter ? "Recipient not found" : "Channel not set up" })
        .eq("id", delivery.id);
      result.skipped += 1;
      continue;
    }
    try {
      await adapter.send(
        { id: notification.id, type: notification.type, title: notification.title, body: notification.body },
        { id: user.id, email: user.email, phone: user.phone, fullName: user.full_name },
      );
      await db
        .from("notification_deliveries")
        .update({
          status: "sent",
          attempts: delivery.attempts + 1,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", delivery.id);
      result.sent += 1;
    } catch (cause) {
      const attempts = delivery.attempts + 1;
      await db
        .from("notification_deliveries")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          last_error: cause instanceof Error ? cause.message.slice(0, 500) : "Send failed",
        })
        .eq("id", delivery.id);
      logger.warn("Notification delivery failed", { deliveryId: delivery.id, channel: delivery.channel });
      result.failed += 1;
    }
  }
  return result;
}
