"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

async function unreadCount(userId: string): Promise<number | null> {
  const { count } = await createClient()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count;
}

/** Header bell with the unread count, kept live over Realtime. */
export function NotificationBell({ userId, initialCount }: { userId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  // The header stays mounted across navigations, so recount when the page changes (opening a
  // notification or "Mark all read" lowers the count).
  useEffect(() => {
    let cancelled = false;
    void unreadCount(userId).then((unread) => {
      if (!cancelled && unread !== null) setCount(unread);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, userId]);

  useEffect(() => {
    const client = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    // Authenticate the realtime socket before joining; otherwise row level security hides every row.
    void client.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      await client.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = client
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          () =>
            void unreadCount(userId).then((unread) => {
              if (!cancelled && unread !== null) setCount(unread);
            }),
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [userId]);

  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 items-center justify-center rounded-xl hover:bg-surface-muted"
    >
      <Bell aria-hidden className="size-5" />
      {count > 0 && (
        <span
          data-testid="notification-count"
          className={cn(
            "absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1",
            "text-[10px] leading-none font-semibold text-accent-foreground",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
