import { categoryLabel } from "@/lib/notifications/categories";
import type { NotificationItem } from "@/lib/notifications/queries";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Each item opens through /notifications/go/<id>, which marks it read and sends the reader to the
 * right page. Plain <a> links: a prefetch must never mark a notification as read.
 */
export function NotificationList({
  notifications,
  showCategory = true,
}: {
  notifications: Pick<NotificationItem, "id" | "category" | "title" | "body" | "read_at" | "created_at">[];
  showCategory?: boolean;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {notifications.map((n) => (
        <li key={n.id} data-unread={n.read_at ? undefined : ""}>
          <a
            href={`/notifications/go/${n.id}`}
            className={cn("flex gap-3 p-4 hover:bg-surface-muted", !n.read_at && "bg-accent/5")}
          >
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                n.read_at ? "bg-transparent" : "bg-accent",
              )}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("text-sm", !n.read_at && "font-semibold")}>
                {!n.read_at && <span className="sr-only">Unread: </span>}
                {n.title}
              </span>
              {n.body && <span className="text-sm text-muted">{n.body}</span>}
              <span className="text-xs text-muted">
                {showCategory && <>{categoryLabel(n.category)} · </>}
                {formatDateTime(n.created_at)}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
