import type { BookingStatus } from "@/lib/bookings/rules";

export type BusinessBookingAction = "quote" | "accept" | "decline" | "start" | "complete" | "cancel";

/** What the business can do next with a booking in each status. */
export function businessBookingActions(status: BookingStatus): BusinessBookingAction[] {
  switch (status) {
    case "quote_requested":
      return ["quote", "decline"];
    case "requested":
      return ["accept", "decline"];
    case "quoted":
    case "accepted":
      return ["cancel"];
    case "confirmed":
      return ["start", "complete", "cancel"];
    case "in_progress":
      return ["complete"];
    default:
      return [];
  }
}

/** Bookings that need the business to respond. */
export const needsResponseStatuses: BookingStatus[] = ["quote_requested", "requested"];

/** What the business sees for each status. */
export const businessBookingStatusLabels: Record<BookingStatus, string> = {
  quote_requested: "Quote requested",
  quoted: "Quote sent",
  requested: "New request",
  accepted: "Awaiting payment",
  confirmed: "Confirmed and paid",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Declined",
  expired: "Expired",
  disputed: "In dispute",
};
