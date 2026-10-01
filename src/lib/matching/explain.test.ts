import { describe, expect, it } from "vitest";

import { describeRequest, explainMatch, formatRequestDate, isFullMatch } from "./explain";
import { parseServiceRequest } from "./request";
import type { Match } from "./types";

const base: Match = {
  id: "c0000000-0000-0000-0000-000000000010",
  name: "Snapshot Studios",
  slug: "snapshot-studios",
  description: null,
  logo_path: null,
  cover_path: null,
  city: "Lagos",
  state: "Lagos",
  is_verified: true,
  rating_avg: 4.8,
  rating_count: 12,
  category_name: "Photography & video",
  min_price_minor: 25_000_000,
  max_price_minor: 25_000_000,
  has_quote_only: false,
  matched_services: ["Birthday & Party Coverage (up to 150 guests)"],
  served_areas: ["Victoria Island"],
  completed_bookings: 3,
  location_match: "area",
  availability: "available",
  availability_note: null,
  within_budget: true,
  guest_capacity: 150,
  fits_guests: true,
  score: 93,
  score_parts: {},
};

const request = parseServiceRequest(
  "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k.",
  new Date("2026-10-01T11:00:00Z"),
);

describe("explainMatch", () => {
  it("says which needs a full match meets", () => {
    const reasons = explainMatch(base, request);
    expect(reasons.every((reason) => reason.met)).toBe(true);
    expect(reasons.map((reason) => reason.text)).toEqual([
      "Serves Victoria Island",
      "Available Sat, 10 Oct",
      "Birthday & Party Coverage (up to 150 guests) from ₦250k, within your ₦300k budget",
      "Handles up to 150 guests",
      "3 completed bookings on Concierge",
      "Rated 4.8 from 12 reviews",
      "Verified by our team",
    ]);
    expect(isFullMatch(base)).toBe(true);
  });

  it("says what a close option misses", () => {
    const miss: Match = {
      ...base,
      location_match: "nearby",
      city: "Ikeja",
      availability: "unavailable",
      availability_note: "Not working that day",
      min_price_minor: 60_000_000,
      within_budget: false,
      guest_capacity: 60,
      fits_guests: false,
      completed_bookings: 0,
      rating_count: 0,
    };
    const unmet = explainMatch(miss, request).filter((reason) => !reason.met);
    expect(unmet.map((reason) => reason.kind)).toEqual(["location", "availability", "price", "guests"]);
    expect(unmet[1]!.text).toBe("Not working that day (Sat, 10 Oct)");
    expect(unmet[3]!.text).toBe("Takes up to 60 guests, fewer than your 100");
    expect(isFullMatch(miss)).toBe(false);
  });

  it("keeps quiet about needs the customer didn't mention", () => {
    const reasons = explainMatch(
      { ...base, location_match: null, availability: "unknown", within_budget: null, fits_guests: null },
      { location: null, date: null, time: null, guests: null, budgetMinor: null },
    );
    expect(reasons.map((reason) => reason.kind)).toEqual(["price", "experience", "rating", "verified"]);
  });
});

describe("describeRequest", () => {
  it("lists Francis's example as structured details", () => {
    expect(describeRequest(request)).toEqual([
      { label: "Category", value: "Photography & video" },
      { label: "Event", value: "Birthday" },
      { label: "Location", value: "Victoria Island, Lagos" },
      { label: "Date", value: "Sat, 10 Oct" },
      { label: "Guests", value: "100" },
      { label: "Budget", value: "₦300,000" },
    ]);
  });

  it("formats dates without shifting the day", () => {
    expect(formatRequestDate("2026-12-31")).toBe("Thu, 31 Dec");
  });
});

describe("typed locations", () => {
  it("reads a short place name back in full", () => {
    const [first] = explainMatch(base, {
      location: "vi",
      date: null,
      time: null,
      guests: null,
      budgetMinor: null,
    });
    expect(first).toEqual({ kind: "location", text: "Serves Victoria Island", met: true });
  });
});
