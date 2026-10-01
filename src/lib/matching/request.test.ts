import { describe, expect, it } from "vitest";

import { findDate, parseServiceRequest, resolvePlace } from "./request";

// Thursday 1 October 2026, midday in Lagos.
const now = new Date("2026-10-01T11:00:00Z");
const today = "2026-10-01";

describe("parseServiceRequest", () => {
  it("reads Francis's example into structured details", () => {
    const request = parseServiceRequest(
      "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k.",
      now,
    );
    expect(request).toMatchObject({
      category: { slug: "photography-video", label: "Photography & video" },
      event: { key: "birthday", label: "Birthday" },
      location: { area: "Victoria Island", city: "Lagos", state: "Lagos", label: "Victoria Island" },
      date: "2026-10-10",
      time: null,
      guests: 100,
      budgetMinor: 30_000_000,
    });
    expect(request.keywords).toContain("birthday");
    expect(request.keywords).not.toMatch(/victoria|saturday|100|300/i);
  });

  it("reads the homepage example", () => {
    const request = parseServiceRequest(
      "I need a wedding decorator in Lekki for 300 guests with a ₦1.5m budget.",
      now,
    );
    expect(request).toMatchObject({
      category: { slug: "event-decoration" },
      event: { key: "wedding" },
      location: { area: "Lekki", state: "Lagos" },
      guests: 300,
      budgetMinor: 150_000_000,
    });
  });

  it.each([
    [
      "cleaner in VI under 50k",
      { budgetMinor: 5_000_000, category: { slug: "cleaning" } },
      "Victoria Island",
    ],
    [
      "plumber Ikeja budget 20,000 naira",
      { budgetMinor: 2_000_000, category: { slug: "plumbing" } },
      "Ikeja",
    ],
    [
      "bridal makeup artist in ikoyi N150k",
      { budgetMinor: 15_000_000, category: { slug: "makeup-hair" } },
      "Ikoyi",
    ],
    ["movers in Abuja", { budgetMinor: null, category: { slug: "moving" } }, "Abuja"],
    [
      "caterer for 200 people 2 million",
      { guests: 200, budgetMinor: 200_000_000, category: { slug: "catering" } },
      null,
    ],
  ])("%s", (input, expected, label) => {
    const request = parseServiceRequest(input, now);
    expect(request).toMatchObject(expected);
    expect(request.location?.label ?? null).toBe(label);
  });

  it("does not mistake guest counts for money", () => {
    expect(parseServiceRequest("photographer for 150 guests", now).budgetMinor).toBeNull();
  });

  it("copes with requests it can't categorise", () => {
    const request = parseServiceRequest("someone to help with my event", now);
    expect(request.category).toBeNull();
    expect(request.location).toBeNull();
    expect(request.date).toBeNull();
  });

  it("reads a date and a time together", () => {
    expect(parseServiceRequest("caterer on 24/10 at 2pm in Abuja", now)).toMatchObject({
      date: "2026-10-24",
      time: "14:00",
      location: { city: "Abuja", state: "FCT", area: null },
    });
  });

  it("ignores dates in the past", () => {
    expect(parseServiceRequest("cleaner on 2026-09-01", now).date).toBeNull();
  });
});

describe("findDate", () => {
  it.each([
    ["next saturday", "2026-10-10"],
    ["this saturday", "2026-10-03"],
    ["saturday", "2026-10-03"],
    ["next monday", "2026-10-05"],
    ["thursday", "2026-10-08"],
    ["tomorrow", "2026-10-02"],
    ["today", "2026-10-01"],
    ["this weekend", "2026-10-03"],
    ["next weekend", "2026-10-10"],
    ["10 oct", "2026-10-10"],
    ["december 5th", "2026-12-05"],
    ["5 january", "2027-01-05"],
    ["2026-11-20", "2026-11-20"],
    ["20/11/2026", "2026-11-20"],
  ])("%s", (text, expected) => {
    expect(findDate(text, today)?.value).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(findDate("31 june", today)).toBeNull();
  });
});

describe("resolvePlace", () => {
  it.each([
    ["vi", "Victoria Island", "Lagos"],
    ["Lekki", "Lekki", "Lagos"],
    ["lagos", null, "Lagos"],
    ["PH", null, "Rivers"],
    ["Wuse", "Wuse", "FCT"],
  ])("%s", (text, area, state) => {
    expect(resolvePlace(text)).toMatchObject({ area, state });
  });

  it("returns null for places it doesn't know", () => {
    expect(resolvePlace("Timbuktu")).toBeNull();
  });
});
