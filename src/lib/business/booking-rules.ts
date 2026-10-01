import type { BookingStatus } from "@/lib/bookings/rules";

export type BusinessBookingAction = "quote" | "accept" | "decline" | "start" | "complete" | "cancel";

/** What the business can do next with a booking in each status. */
export function businessBookingActions(status: BookingStatus, needsQuote = false): BusinessBookingAction[] {
  switch (status) {
    case "pending_provider":
      return needsQuote ? ["quote", "decline"] : ["accept", "decline"];
    case "quoted":
    case "accepted":
    case "payment_pending":
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
export const needsResponseStatuses: BookingStatus[] = ["pending_provider"];

/** What the business sees for each status. */
export const businessBookingStatusLabels: Record<BookingStatus, string> = {
  quote_requested: "Quote requested",
  requested: "New request",
  pending_provider: "Needs your answer",
  quoted: "Quote sent",
  accepted: "Awaiting payment",
  payment_pending: "Customer paying",
  confirmed: "Confirmed and paid",
  in_progress: "In progress",
  completed: "Completed",
  reviewed: "Reviewed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  disputed: "In dispute",
  refunded: "Refunded",
};
