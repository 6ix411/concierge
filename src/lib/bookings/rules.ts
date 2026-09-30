import type { Database } from "@/types/database";

export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type PricingType = Database["public"]["Enums"]["pricing_type"];

/** What customers see for each status. */
export const bookingStatusLabels: Record<BookingStatus, string> = {
  quote_requested: "Quote requested",
  quoted: "Quote received",
  requested: "Waiting for business",
  accepted: "Accepted, awaiting payment",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Declined by business",
  expired: "Expired",
  disputed: "In dispute",
};

export type StatusTone = "neutral" | "accent" | "verified" | "danger";
export const bookingStatusTone: Record<BookingStatus, StatusTone> = {
  quote_requested: "neutral",
  quoted: "accent",
  requested: "neutral",
  accepted: "accent",
  confirmed: "verified",
  in_progress: "verified",
  completed: "verified",
  cancelled: "danger",
  rejected: "danger",
  expired: "neutral",
  disputed: "danger",
};

export const activeStatuses: BookingStatus[] = [
  "quote_requested",
  "quoted",
  "requested",
  "accepted",
  "confirmed",
  "in_progress",
  "disputed",
];

/** Hours before the start time after which a customer can no longer change a booking themselves. */
export const CUSTOMER_CHANGE_CUTOFF_HOURS = 24;

type BookingLike = { status: BookingStatus; scheduled_start: string | null };

function hoursUntil(start: string | null, now: Date): number {
  if (!start) return Number.POSITIVE_INFINITY;
  return (new Date(start).getTime() - now.getTime()) / 36e5;
}

/**
 * Platform cancellation rules (customer side):
 * - Before payment (quote/requested/accepted): cancel any time.
 * - After payment (confirmed): cancel up to 24 hours before the start; refunds are handled
 *   by the payments stage. Inside 24 hours, open a dispute instead.
 */
export function canCustomerCancel(booking: BookingLike, now = new Date()): boolean {
  switch (booking.status) {
    case "quote_requested":
    case "quoted":
    case "requested":
    case "accepted":
      return true;
    case "confirmed":
      return hoursUntil(booking.scheduled_start, now) >= CUSTOMER_CHANGE_CUTOFF_HOURS;
    default:
      return false;
  }
}

/** Customers can move the date themselves until the business has accepted; after that they agree it in chat. */
export function canCustomerReschedule(booking: BookingLike): boolean {
  return (
    booking.status === "quote_requested" || booking.status === "requested" || booking.status === "quoted"
  );
}

export function canCustomerPay(booking: BookingLike): boolean {
  return booking.status === "accepted";
}

export function canCustomerAcceptQuote(booking: BookingLike): boolean {
  return booking.status === "quoted";
}

export function canMessage(booking: BookingLike): boolean {
  return ["confirmed", "in_progress", "completed", "disputed"].includes(booking.status);
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
