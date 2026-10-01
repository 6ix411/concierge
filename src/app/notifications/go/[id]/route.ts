import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { adminHref } from "@/lib/auth/admin-path";
import { getSessionUser } from "@/lib/auth/session";
import { notificationTarget } from "@/lib/notifications/links";
import { createClient } from "@/lib/supabase/server";

/** Opens a notification: marks it read and redirects to the page it is about. */
export async function GET(request: NextRequest, ctx: RouteContext<"/notifications/go/[id]">) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const user = await getSessionUser();
  if (!user) return to("/sign-in?next=%2Fnotifications");
  if (user.status !== "active") return to("/account-suspended");

  const id = z.guid().safeParse((await ctx.params).id);
  if (!id.success) return to("/notifications");

  // Row level security: only the person's own notifications are found or updated.
  const supabase = await createClient();
  const { data: notification } = await supabase
    .from("notifications")
    .select("id, type, data, read_at")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!notification) return to("/notifications");

  // A prefetch must not count as opening it.
  if (!notification.read_at && !request.headers.has("next-router-prefetch")) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notification.id)
      .is("read_at", null);
  }

  const target = notificationTarget(notification, user.role);
  if (!target) return to(user.role === "admin" ? adminHref("notifications") : "/notifications");
  return to(target.admin ? adminHref(target.path) : target.path);
}
