import type { Metadata } from "next";
import Link from "next/link";

import { BusinessBookingList } from "@/components/business/business-booking-list";
import { EmptyState } from "@/components/ui";
import { bookingTabs, listBusinessBookings, type BookingTab } from "@/lib/business/booking-queries";
import { requireOwnBusiness } from "@/lib/business/queries";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Bookings" };

const emptyText: Record<BookingTab, string> = {
  requests: "New booking and quote requests will show up here.",
  upcoming: "Accepted and confirmed bookings will show up here.",
  past: "Completed, cancelled and declined bookings will show up here.",
};

export default async function BusinessBookingsPage({ searchParams }: PageProps<"/business/bookings">) {
  const { business } = await requireOwnBusiness();
  const { tab: rawTab } = await searchParams;
  const tab: BookingTab = rawTab === "upcoming" || rawTab === "past" ? rawTab : "requests";
  const bookings = await listBusinessBookings(business.id, tab);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
      <nav aria-label="Booking lists" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1">
        {(Object.keys(bookingTabs) as BookingTab[]).map((key) => (
          <Link
            key={key}
            href={key === "requests" ? "/business/bookings" : `/business/bookings?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "flex h-10 items-center justify-center rounded-lg text-sm font-medium",
              tab === key ? "bg-surface shadow-sm" : "text-muted",
            )}
          >
            {bookingTabs[key].label}
          </Link>
        ))}
      </nav>
      {bookings.length > 0 ? (
        <BusinessBookingList bookings={bookings} />
      ) : (
        <EmptyState
          title={`No ${bookingTabs[tab].label.toLowerCase()} bookings`}
          description={emptyText[tab]}
        />
      )}
    </div>
  );
}
