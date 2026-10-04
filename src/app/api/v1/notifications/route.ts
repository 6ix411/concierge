import { apiRoute, requireApiUser } from "@/lib/api/v1";
import { countUnread, listNotifications } from "@/lib/notifications/queries";

export const dynamic = "force-dynamic";

/** The account's latest notifications and how many are unread. Query: unread=1 for unread only. */
export const GET = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  const unreadOnly = new URL(request.url).searchParams.get("unread") === "1";
  const [items, unread] = await Promise.all([
    listNotifications(user.id, { unreadOnly }),
    countUnread(user.id),
  ]);
  return { items, unread };
});
