import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BookingList } from "@/components/bookings/booking-list";
import { ConciergeBox } from "@/components/concierge/concierge-box";
import { Button, EmptyState } from "@/components/ui";
import { markNotificationsReadAction } from "@/lib/account/actions";
import { requireAreaAccess } from "@/lib/auth/session";
import { listCustomerBookings } from "@/lib/bookings/queries";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireAreaAccess("account");
  const supabase = await createClient();
  const [upcoming, { data: notifications }] = await Promise.all([
    listCustomerBookings(user.id, "upcoming"),
    supabase
      .from("notifications")
      .select("id, title, body, created_at, read_at, data")
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
            {unread.length > 0 && (
              <form action={markNotificationsReadAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Mark all read
                </Button>
              </form>
            )}
          </div>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {notifications.map((n) => {
              const bookingId =
                n.data &&
                typeof n.data === "object" &&
                !Array.isArray(n.data) &&
                typeof n.data.bookingId === "string"
                  ? n.data.bookingId
                  : null;
              const content = (
                <>
                  <p className={n.read_at ? "text-sm" : "text-sm font-semibold"}>{n.title}</p>
                  {n.body && <p className="text-sm text-muted">{n.body}</p>}
                  <p className="text-xs text-muted">{formatDateTime(n.created_at)}</p>
                </>
              );
              return (
                <li key={n.id}>
                  {bookingId ? (
                    <Link
                      href={`/account/bookings/${bookingId}`}
                      className="block p-4 hover:bg-surface-muted"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="p-4">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
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
