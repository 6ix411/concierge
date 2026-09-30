import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import type { BookingListItem } from "@/lib/bookings/queries";
import { formatDateTime, formatNaira } from "@/lib/format";

import { BookingStatusBadge } from "./booking-status-badge";

export function BookingList({ bookings }: { bookings: BookingListItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {bookings.map((booking) => (
        <li key={booking.id}>
          <Link
            href={`/account/bookings/${booking.id}`}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-foreground/30"
          >
            <BusinessAvatar
              name={booking.businesses?.name ?? "?"}
              logoPath={booking.businesses?.logo_path ?? null}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{booking.businesses?.name}</p>
                <BookingStatusBadge status={booking.status} />
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
