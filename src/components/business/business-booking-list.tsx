import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui";
import { businessBookingStatusLabels } from "@/lib/business/booking-rules";
import type { BusinessBookingListItem } from "@/lib/business/booking-queries";
import { bookingStatusTone } from "@/lib/bookings/rules";
import { formatDateTime, formatNaira, initials } from "@/lib/format";

export function BusinessBookingStatus({ status }: { status: BusinessBookingListItem["status"] }) {
  return <Badge tone={bookingStatusTone[status]}>{businessBookingStatusLabels[status]}</Badge>;
}

export function BusinessBookingList({ bookings }: { bookings: BusinessBookingListItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {bookings.map((booking) => (
        <li key={booking.id}>
          <Link
            href={`/business/bookings/${booking.id}`}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-foreground/30"
          >
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold"
            >
              {initials(booking.customerName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{booking.customerName}</p>
                <BusinessBookingStatus status={booking.status} />
              </div>
              <p className="truncate text-sm text-muted">
                {booking.booking_items.map((item) => item.name).join(", ") || "Quote request"}
              </p>
              <p className="text-sm text-muted">
                {booking.scheduled_start ? formatDateTime(booking.scheduled_start) : "Date to be agreed"}
                {booking.total_minor > 0 && ` · ${formatNaira(booking.total_minor)}`}
              </p>
            </div>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
