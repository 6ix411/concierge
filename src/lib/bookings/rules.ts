import type { Database } from "@/types/database";

export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type PricingType = Database["public"]["Enums"]["pricing_type"];

/** What customers see for each status. */
export const bookingStatusLabels: Record<BookingStatus, string> = {
  quote_requested: "Quote requested",
  requested: "Requested",
  pending_provider: "Waiting for business",
  quoted: "Quote received",
  accepted: "Accepted, pay to confirm",
  payment_pending: "Payment pending",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  reviewed: "Reviewed",
  declined: "Declined by business",
  cancelled: "Cancelled",
  expired: "Expired",
  disputed: "In dispute",
  refunded: "Refunded",
};

export type StatusTone = "neutral" | "accent" | "verified" | "danger";
export const bookingStatusTone: Record<BookingStatus, StatusTone> = {
  quote_requested: "neutral",
  requested: "neutral",
  pending_provider: "neutral",
  quoted: "accent",
  accepted: "accent",
  payment_pending: "accent",
  confirmed: "verified",
  in_progress: "verified",
  completed: "verified",
  reviewed: "verified",
  declined: "danger",
  cancelled: "danger",
  expired: "neutral",
  disputed: "danger",
  refunded: "neutral",
};

/** Bookings still in motion (shown as upcoming). */
export const activeStatuses: BookingStatus[] = [
  "requested",
  "pending_provider",
  "quoted",
  "accepted",
  "payment_pending",
  "confirmed",
  "in_progress",
  "disputed",
];

/** Jobs that have been done, reviewed or not. */
export const doneStatuses: BookingStatus[] = ["completed", "reviewed"];

/** Bookings the customer has paid for. */
export const paidStatuses: BookingStatus[] = [
  "confirmed",
  "in_progress",
  "completed",
  "reviewed",
  "disputed",
];

/** Statuses that hold a slot in the business's day. */
export const busyStatuses: BookingStatus[] = ["accepted", "payment_pending", "confirmed", "in_progress"];

/** Hours before the start time after which a customer can no longer change a booking themselves. */
export const CUSTOMER_CHANGE_CUTOFF_HOURS = 24;

type BookingLike = { status: BookingStatus; scheduled_start: string | null };

function hoursUntil(start: string | null, now: Date): number {
  if (!start) return Number.POSITIVE_INFINITY;
  return (new Date(start).getTime() - now.getTime()) / 36e5;
}

/**
 * Platform cancellation rules (customer side):
 * - Before payment (requested, waiting for the business, quoted, accepted, payment pending): any time.
 * - After payment (confirmed): up to 24 hours before the start; the payment is then refunded.
 *   Inside 24 hours, open a dispute instead.
 */
export function canCustomerCancel(booking: BookingLike, now = new Date()): boolean {
  switch (booking.status) {
    case "requested":
    case "pending_provider":
    case "quoted":
    case "accepted":
    case "payment_pending":
      return true;
    case "confirmed":
      return hoursUntil(booking.scheduled_start, now) >= CUSTOMER_CHANGE_CUTOFF_HOURS;
    default:
      return false;
  }
}

/** Customers can move the date themselves until the business has accepted; after that they agree it in chat. */
export function canCustomerReschedule(booking: BookingLike): boolean {
  return ["requested", "pending_provider", "quoted"].includes(booking.status);
}

/** Pay once accepted; a payment that didn't go through can be tried again. */
export function canCustomerPay(booking: BookingLike): boolean {
  return booking.status === "accepted" || booking.status === "payment_pending";
}

export function canCustomerAcceptQuote(booking: BookingLike): boolean {
  return booking.status === "quoted";
}

export function canMessage(booking: BookingLike): boolean {
  return ["confirmed", "in_progress", "completed", "reviewed", "disputed"].includes(booking.status);
}

export function canReview(booking: BookingLike & { hasReview: boolean }): boolean {
  return booking.status === "completed" && !booking.hasReview;
}

export type PricedService = {
  id: string;
  name: string;
  pricing_type: PricingType;
  price_minor: number | null;
};

export type LineItem = { serviceId: string; name: string; unitPriceMinor: number; quantity: number };

export type BookingQuote = {
  items: LineItem[];
  subtotalMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  /** A business must confirm a price for "starting from" or "quote only" services. */
  needsQuote: boolean;
};

/**
 * Prices a booking on the server from the business's current service prices.
 * The browser never sends prices. The platform takes its commission from the business
 * side, so customers pay the listed price with no added fee.
 */
export function priceBooking(
  services: PricedService[],
  selection: { serviceId: string; quantity: number }[],
): BookingQuote {
  const byId = new Map(services.map((service) => [service.id, service]));
  const items: LineItem[] = [];
  let needsQuote = false;

  for (const { serviceId, quantity } of selection) {
    const service = byId.get(serviceId);
    if (!service) throw new Error(`Unknown service ${serviceId}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("Invalid quantity");
    if (service.pricing_type === "quote_only" || service.pricing_type === "starting_from") needsQuote = true;
    items.push({
      serviceId,
      name: service.name,
      unitPriceMinor: service.price_minor ?? 0,
      quantity,
    });
  }

  const subtotalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
  return { items, subtotalMinor, platformFeeMinor: 0, totalMinor: subtotalMinor, needsQuote };
}

export type AvailabilityRule = {
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
};

function minutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Whether a business works at the given local (Lagos) date and time, using weekly rules
 * and one-off date overrides. `date` is YYYY-MM-DD and `time` is HH:MM.
 */
export function isWithinAvailability(rules: AvailabilityRule[], date: string, time: string): boolean {
  const overrides = rules.filter((rule) => rule.specific_date === date);
  const candidates =
    overrides.length > 0
      ? overrides
      : rules.filter((rule) => rule.day_of_week === new Date(`${date}T12:00:00Z`).getUTCDay());
  const at = minutes(time);
  return candidates.some(
    (rule) =>
      rule.is_available &&
      rule.start_time !== null &&
      rule.end_time !== null &&
      at >= minutes(rule.start_time) &&
      at < minutes(rule.end_time),
  );
}

/**
 * A business's booking rules: minimum notice before the start, and how far ahead customers can book.
 * Returns field errors, or null when the time is fine.
 */
export function checkBookingWindow(
  rules: { min_notice_hours: number; booking_window_days: number },
  start: Date,
  now = new Date(),
): Partial<Record<"date" | "time", string>> | null {
  const hoursAhead = (start.getTime() - now.getTime()) / 36e5;
  if (hoursAhead < rules.min_notice_hours) {
    const days = rules.min_notice_hours / 24;
    const [amount, unit] = Number.isInteger(days) ? [days, "day"] : [rules.min_notice_hours, "hour"];
    const notice = amount === 1 ? `1 ${unit}’s` : `${amount} ${unit}s’`;
    return { time: `This business needs at least ${notice} notice. Pick a later time.` };
  }
  if (hoursAhead > rules.booking_window_days * 24) {
    return { date: `This business takes bookings up to ${rules.booking_window_days} days ahead.` };
  }
  return null;
}
