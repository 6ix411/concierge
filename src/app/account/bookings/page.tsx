import type { Metadata } from "next";
import Link from "next/link";

import { FormMessage } from "@/components/auth/form-message";
import { BookingList } from "@/components/bookings/booking-list";
import { EmptyState, LinkButton } from "@/components/ui";
import { requireAreaAccess } from "@/lib/auth/session";
import { listCustomerBookings } from "@/lib/bookings/queries";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "My bookings" };

const paymentNotices: Record<string, string> = {
  invalid: "That payment link wasn’t valid.",
  error: "We couldn’t confirm your payment. If you were charged, it will be matched to your booking shortly.",
};

export default async function BookingsPage({ searchParams }: PageProps<"/account/bookings">) {
  const user = await requireAreaAccess("account");
  const { view, payment } = await searchParams;
  const current = view === "past" ? "past" : "upcoming";
  const bookings = await listCustomerBookings(user.id, current);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
      {typeof payment === "string" && paymentNotices[payment] && (
        <FormMessage tone="error">{paymentNotices[payment]}</FormMessage>
      )}
      <div className="grid w-full max-w-xs grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
        {(["upcoming", "past"] as const).map((tab) => (
          <Link
            key={tab}
            href={tab === "upcoming" ? "/account/bookings" : "/account/bookings?view=past"}
            aria-current={current === tab ? "page" : undefined}
            className={cn(
              "rounded-lg py-2 text-center text-sm font-medium capitalize",
              current === tab ? "bg-surface shadow-sm" : "text-muted",
            )}
          >
            {tab}
          </Link>
        ))}
      </div>
      {bookings.length > 0 ? (
        <BookingList bookings={bookings} />
      ) : (
        <EmptyState
          title={current === "upcoming" ? "No upcoming bookings" : "No past bookings"}
          description="Tell the concierge what you need and book a verified provider."
          action={<LinkButton href="/concierge">Find My Provider</LinkButton>}
        />
      )}
    </div>
  );
}
