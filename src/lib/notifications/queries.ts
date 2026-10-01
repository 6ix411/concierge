import "server-only";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const NOTIFICATION_COLUMNS = "id, type, category, title, body, data, read_at, created_at";

/** The signed-in user's notifications, newest first (row level security: their own only). */
export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; category?: string; limit?: number } = {},
) {
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.unreadOnly) query = query.is("read_at", null);
  if (options.category) query = query.eq("category", options.category);
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load notifications.", { cause: error });
  return data ?? [];
}

export async function countUnread(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}

export type NotificationItem = Awaited<ReturnType<typeof listNotifications>>[number];
