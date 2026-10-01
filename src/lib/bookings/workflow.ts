import { formatDateTime, formatNaira } from "@/lib/format";
import type { Database } from "@/types/database";

import type { BookingStatus } from "./rules";

/**
 * The booking workflow. The database enforces the same transitions
 * (`is_valid_booking_transition`); this copy drives what the screens offer.
 *
 *   requested → pending_provider → accepted → payment_pending → confirmed → in_progress → completed → reviewed
 *
 * Quote requests go pending_provider → quoted → accepted. A booking can also end declined, cancelled,
 * expired or refunded, or be disputed after payment.
 */
export const mainFlow = [
  "requested",
  "pending_provider",
  "accepted",
  "payment_pending",
  "confirmed",
  "in_progress",
  "completed",
  "reviewed",
] as const satisfies BookingStatus[];

export const transitions: Record<BookingStatus, BookingStatus[]> = {
  quote_requested: [],
  requested: ["pending_provider", "cancelled"],
  pending_provider: ["accepted", "quoted", "declined", "cancelled", "expired"],
  quoted: ["accepted", "cancelled", "expired"],
  accepted: ["payment_pending", "cancelled", "expired"],
  payment_pending: ["confirmed", "cancelled", "expired"],
  confirmed: ["in_progress", "completed", "cancelled", "disputed"],
  in_progress: ["completed", "disputed", "cancelled"],
  completed: ["reviewed", "disputed"],
  reviewed: ["disputed"],
  disputed: ["completed", "reviewed", "cancelled", "confirmed", "in_progress"],
  cancelled: ["refunded"],
  declined: [],
  expired: [],
  refunded: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return from === to || transitions[from].includes(to);
}

/** Short names for the progress tracker. */
export const stepLabels: Record<(typeof mainFlow)[number], string> = {
  requested: "Requested",
  pending_provider: "With the business",
  accepted: "Accepted",
  payment_pending: "Payment",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  reviewed: "Reviewed",
};

/**
 * How far along the main flow a booking is: the index of its step, or of the last step it reached
 * before leaving the main flow (a quote counts as being with the business).
 */
export function flowPosition(status: BookingStatus, reached: BookingStatus[] = []): number {
  const index = (s: BookingStatus) => (s === "quoted" ? 1 : mainFlow.indexOf(s as (typeof mainFlow)[number]));
  const own = index(status);
  if (own >= 0) return own;
  return Math.max(0, ...reached.map(index));
}

export type BookingEvent = Pick<
  Database["public"]["Tables"]["booking_events"]["Row"],
  "id" | "event" | "from_status" | "to_status" | "actor_role" | "note" | "metadata" | "created_at"
>;

export type HistoryViewer = "customer" | "business" | "admin";

const statusEventLabels: Partial<Record<BookingStatus, string>> = {
  pending_provider: "Sent to the business",
  quoted: "Quote sent",
  accepted: "Accepted by the business",
  payment_pending: "Payment started",
  confirmed: "Paid and confirmed",
  in_progress: "Job started",
  completed: "Job completed",
  reviewed: "Review left",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  disputed: "Problem reported",
  refunded: "Refunded",
};

/** One line of booking history, in plain words. */
export function describeEvent(event: BookingEvent): string {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  if (event.event === "created") return "Booking requested";
  if (event.event === "rescheduled") {
    return typeof metadata.to === "string" ? `Moved to ${formatDateTime(metadata.to)}` : "Time changed";
  }
  if (event.from_status === "disputed" && event.to_status !== "cancelled") return "Dispute closed";
  if (event.from_status === null) {
    return `Status: ${event.to_status ? (statusEventLabels[event.to_status] ?? event.to_status) : "unknown"}`;
  }
  const label = (event.to_status && statusEventLabels[event.to_status]) ?? "Updated";
  if (event.to_status === "quoted" && typeof metadata.total_minor === "number") {
    return `${label}: ${formatNaira(metadata.total_minor)}`;
  }
  return label;
}

/** Who made the change, from the viewer's point of view. Null for automatic steps. */
export function describeActor(
  role: string,
  viewer: HistoryViewer,
  names: { customer: string; business: string },
): string | null {
  switch (role) {
    case "customer":
      return viewer === "customer" ? "You" : names.customer;
    case "business":
      return viewer === "business" ? "You" : names.business;
    case "admin":
      return "Concierge team";
    default:
      return null;
  }
}

/** Oldest first; same-time events keep their recorded order. */
export function sortEvents<T extends { created_at: string }>(events: T[]): T[] {
  return events.toSorted((a, b) => a.created_at.localeCompare(b.created_at));
}

export const itemKindLabels: Record<string, string | null> = {
  service: null,
  package: "Package",
  addon: "Add-on",
};

/** "12 Admiralty Way, Lekki, Lagos, Lagos" without repeats or blanks. */
export function formatBookingLocation(booking: {
  address_line: string | null;
  area?: string | null;
  city: string | null;
  state: string | null;
}): string {
  const parts = [booking.address_line, booking.area, booking.city, booking.state]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts
    .filter((part, index) => parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === index)
    .join(", ");
}
