import { describe, expect, it } from "vitest";

import { parseIntent } from "./intent";

describe("parseIntent", () => {
  it("reads the homepage example", () => {
    const intent = parseIntent("I need a wedding decorator in Lekki for 300 guests with a ₦1.5m budget.");
    expect(intent).toMatchObject({
      categorySlug: "event-decoration",
      location: "Lekki",
      guests: 300,
      budgetMinor: 150_000_000,
    });
    expect(intent.keywords).toContain("wedding");
    expect(intent.keywords).not.toMatch(/lekki|300|1\.5/i);
  });

  it.each([
    [
      "cleaner in VI under 50k",
      { location: "Victoria Island", budgetMinor: 5_000_000, categorySlug: "cleaning" },
    ],
    [
      "plumber Ikeja budget 20,000 naira",
      { location: "Ikeja", budgetMinor: 2_000_000, categorySlug: "plumbing" },
    ],
    [
      "bridal makeup artist in ikoyi N150k",
      { location: "Ikoyi", budgetMinor: 15_000_000, categorySlug: "makeup-hair" },
    ],
    ["movers in Abuja", { location: "Abuja", budgetMinor: null, categorySlug: "moving" }],
    ["caterer for 200 people 2 million", { guests: 200, budgetMinor: 200_000_000, categorySlug: "catering" }],
  ])("%s", (input, expected) => {
    expect(parseIntent(input)).toMatchObject(expected);
  });

  it("does not mistake guest counts for money", () => {
    expect(parseIntent("photographer for 150 guests").budgetMinor).toBeNull();
  });

  it("copes with requests it can't categorise", () => {
    expect(parseIntent("someone to help with my event").categorySlug).toBeNull();
  });
});
