import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BookingList } from "@/components/bookings/booking-list";
import { ConciergeBox } from "@/components/concierge/concierge-box";
import { Button, EmptyState } from "@/components/ui";
import { NotificationList } from "@/components/notifications/notification-list";
import { requireAreaAccess } from "@/lib/auth/session";
import { listCustomerBookings } from "@/lib/bookings/queries";
import { markAllNotificationsReadAction } from "@/lib/notifications/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireAreaAccess("account");
  const supabase = await createClient();
  const [upcoming, { data: notifications }] = await Promise.all([
    listCustomerBookings(user.id, "upcoming"),
    supabase
      .from("notifications")
      .select("id, category, title, body, created_at, read_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const unread = (notifications ?? []).filter((n) => !n.read_at);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Hi{user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-muted">What can we help you find today?</p>
      </div>
      <ConciergeBox compact showExamples={false} />

      {notifications && notifications.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Bell aria-hidden className="size-4" />
              Updates
              {unread.length > 0 && (
                <span className="rounded-full bg-accent px-2 text-xs text-accent-foreground">
                  {unread.length}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1">
              {unread.length > 0 && (
                <form action={markAllNotificationsReadAction}>
                  <Button type="submit" variant="ghost" size="sm">
                    Mark all read
                  </Button>
                </form>
              )}
              <Link href="/notifications" className="text-sm font-medium text-muted hover:underline">
                See all
              </Link>
            </div>
          </div>
          <NotificationList notifications={notifications} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Upcoming bookings</h2>
          <Link href="/account/bookings" className="text-sm font-medium text-muted hover:underline">
            All bookings
          </Link>
        </div>
        {upcoming.length > 0 ? (
          <BookingList bookings={upcoming.slice(0, 3)} />
        ) : (
          <EmptyState
            title="Nothing booked yet"
            description="Describe what you need above and we’ll match you."
          />
        )}
      </section>
    </div>
  );
}
