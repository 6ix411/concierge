"use server";

import { refreshPage } from "@/lib/utils/refresh";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** Marks all of the signed-in user's notifications as read. */
export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  refreshPage();
}
