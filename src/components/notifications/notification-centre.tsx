import Link from "next/link";

import { Button, EmptyState } from "@/components/ui";
import { categoryLabel, notificationCategories } from "@/lib/notifications/categories";
import { markAllNotificationsReadAction } from "@/lib/notifications/actions";
import { countUnread, listNotifications } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils/cn";

import { NotificationList } from "./notification-list";

type Search = Record<string, string | string[] | undefined>;

/** The full notification centre: All / Unread, a filter per category, and "Mark all read". */
export async function NotificationCentre({
  userId,
  basePath,
  searchParams,
}: {
  userId: string;
  basePath: string;
  searchParams: Search;
}) {
  const unreadOnly = searchParams.view === "unread";
  const category =
    typeof searchParams.category === "string" && searchParams.category in notificationCategories
      ? searchParams.category
      : undefined;
  const [notifications, unread, recent] = await Promise.all([
    listNotifications(userId, { unreadOnly, category, limit: 100 }),
    countUnread(userId),
    listNotifications(userId, { limit: 200 }),
  ]);
  // Only offer the categories this person has notifications in.
  const categories = [...new Set(recent.map((n) => n.category).filter((c): c is string => Boolean(c)))];

  const href = (params: { view?: string; category?: string }) => {
    const query = new URLSearchParams();
    if (params.view) query.set("view", params.view);
    if (params.category) query.set("category", params.category);
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-block rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap",
      active
        ? "border-brand bg-brand text-brand-foreground"
        : "border-border text-muted hover:bg-surface-muted",
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid w-full max-w-xs grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
          {[
            { key: undefined, label: "All" },
            { key: "unread", label: unread > 0 ? `Unread (${unread})` : "Unread" },
          ].map((tab) => (
            <Link
              key={tab.label}
              href={href({ view: tab.key, category })}
              aria-current={(tab.key === "unread") === unreadOnly ? "page" : undefined}
              className={cn(
                "rounded-lg py-2 text-center text-sm font-medium",
                (tab.key === "unread") === unreadOnly ? "bg-surface shadow-sm" : "text-muted",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        {unread > 0 && (
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="ghost" size="sm">
              Mark all read
            </Button>
          </form>
        )}
      </div>

      {categories.length > 1 && (
        <nav aria-label="Filter by type" className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4">
          <ul className="flex gap-2">
            <li>
              <Link href={href({ view: unreadOnly ? "unread" : undefined })} className={chip(!category)}>
                Everything
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c}>
                <Link
                  href={href({ view: unreadOnly ? "unread" : undefined, category: c })}
                  aria-current={category === c ? "true" : undefined}
                  className={chip(category === c)}
                >
                  {categoryLabel(c)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {notifications.length > 0 ? (
        <NotificationList notifications={notifications} showCategory={!category} />
      ) : (
        <EmptyState
          title={unreadOnly ? "You're all caught up" : "No notifications yet"}
          description={
            unreadOnly
              ? "New updates about your bookings, messages and account will show here."
              : "Updates about your bookings, payments, messages and account will show here."
          }
        />
      )}
    </div>
  );
}
