/**
 * Plain-language explanations of a match: which of the customer's needs a business meets, and which
 * it doesn't. Pure, so it's shared by the concierge and the search page and easy to test.
 */

import { formatNaira, formatNairaShort, formatTime } from "@/lib/format";

import { resolvePlace, type Place, type ServiceRequest } from "./request";
import type { Match } from "./types";

export type ReasonKind =
  "location" | "availability" | "price" | "guests" | "experience" | "rating" | "verified";
export type Reason = { kind: ReasonKind; text: string; met: boolean };

/** The parts of a request a match is checked against. */
export type MatchNeeds = Pick<ServiceRequest, "date" | "time" | "guests" | "budgetMinor"> & {
  location: Place | string | null;
};

const shortDate = new Intl.DateTimeFormat("en-NG", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "2026-10-10" → "Sat, 10 Oct". */
export function formatRequestDate(date: string): string {
  return shortDate.format(new Date(`${date}T12:00:00Z`));
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function explainMatch(match: Match, needs: MatchNeeds): Reason[] {
  const reasons: Reason[] = [];
  // "vi" typed into the search box reads back as "Victoria Island".
  const location =
    typeof needs.location === "string" ? (resolvePlace(needs.location) ?? needs.location) : needs.location;
  const place = typeof location === "string" ? location : (location?.label ?? null);

  switch (match.location_match) {
    case "area":
      reasons.push({ kind: "location", text: `Serves ${place}`, met: true });
      break;
    case "city":
    case "state": {
      const whole =
        typeof location === "object" && location
          ? match.location_match === "city"
            ? location.city
            : location.state
          : null;
      reasons.push({ kind: "location", text: `Covers ${whole ?? place}`, met: true });
      break;
    }
    case "nearby":
      reasons.push({
        kind: "location",
        text: `Works nearby${match.city ? ` (based in ${match.city})` : ""}, not listed for ${place}`,
        met: false,
      });
      break;
  }

  if (needs.date) {
    const when = `${formatRequestDate(needs.date)}${needs.time ? ` at ${formatTime(needs.time)}` : ""}`;
    if (match.availability === "available")
      reasons.push({ kind: "availability", text: `Available ${when}`, met: true });
    else if (match.availability === "unavailable")
      reasons.push({
        kind: "availability",
        text: `${match.availability_note ?? "Not available"} (${when})`,
        met: false,
      });
  }

  const service = match.matched_services?.[0] ?? "Services";
  if (match.min_price_minor !== null) {
    const price = `${service} from ${formatNairaShort(match.min_price_minor)}`;
    if (needs.budgetMinor && match.within_budget !== null) {
      const budget = formatNairaShort(needs.budgetMinor);
      reasons.push(
        match.within_budget
          ? { kind: "price", text: `${price}, within your ${budget} budget`, met: true }
          : { kind: "price", text: `${price}, above your ${budget} budget`, met: false },
      );
    } else {
      reasons.push({ kind: "price", text: price, met: true });
    }
  } else if (match.has_quote_only) {
    reasons.push({ kind: "price", text: `${service}: price on request`, met: true });
  }

  if (needs.guests && match.fits_guests !== null && match.guest_capacity !== null) {
    reasons.push(
      match.fits_guests
        ? { kind: "guests", text: `Handles up to ${match.guest_capacity} guests`, met: true }
        : {
            kind: "guests",
            text: `Takes up to ${match.guest_capacity} guests, fewer than your ${needs.guests}`,
            met: false,
          },
    );
  }

  if (match.completed_bookings > 0) {
    reasons.push({
      kind: "experience",
      text: `${plural(match.completed_bookings, "completed booking")} on Concierge`,
      met: true,
    });
  }
  if (match.rating_count > 0) {
    reasons.push({
      kind: "rating",
      text: `Rated ${Number(match.rating_avg).toFixed(1)} from ${plural(match.rating_count, "review")}`,
      met: true,
    });
  }
  if (match.is_verified) reasons.push({ kind: "verified", text: "Verified by our team", met: true });

  return reasons;
}

/**
 * Display order for matches gathered from several searches: providers lifted by featured placement
 * (which the database only does for providers meeting every requirement) first, then best match.
 */
export function compareMatches(a: Match, b: Match): number {
  return Number(b.is_featured) - Number(a.is_featured) || b.score - a.score;
}

/** True when nothing the customer asked for is known to be missing. */
export function isFullMatch(match: Match): boolean {
  return (
    match.availability !== "unavailable" &&
    match.within_budget !== false &&
    match.fits_guests !== false &&
    match.location_match !== "nearby"
  );
}

/** The structured details read from a request, as label/value pairs for "Here's what I understood". */
export function describeRequest(request: ServiceRequest): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "Category", value: request.category?.label ?? null },
    { label: "Event", value: request.event?.label ?? null },
    {
      label: "Location",
      value: request.location
        ? request.location.area && request.location.city
          ? `${request.location.area}, ${request.location.city}`
          : request.location.label
        : null,
    },
    { label: "Date", value: request.date ? formatRequestDate(request.date) : null },
    { label: "Time", value: request.time ? formatTime(request.time) : null },
    { label: "Guests", value: request.guests ? String(request.guests) : null },
    { label: "Budget", value: request.budgetMinor ? formatNaira(request.budgetMinor) : null },
  ];
  return rows.filter((row): row is { label: string; value: string } => Boolean(row.value));
}
