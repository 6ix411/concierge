import { Badge } from "@/components/ui";
import { bookingStatusLabels, bookingStatusTone, type BookingStatus } from "@/lib/bookings/rules";

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={bookingStatusTone[status]}>{bookingStatusLabels[status]}</Badge>;
}
