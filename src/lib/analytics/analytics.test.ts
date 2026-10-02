import { describe, expect, it } from "vitest";

import { bucketDaily, isLikelyBot, parsePeriod, rate } from "./rules";

describe("isLikelyBot", () => {
  it("skips crawlers, link previews and missing user agents", () => {
    expect(isLikelyBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isLikelyBot("WhatsApp/2.23.20.0")).toBe(true);
    expect(isLikelyBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot("")).toBe(true);
  });

  it("counts real browsers", () => {
    expect(
      isLikelyBot(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe(false);
    expect(isLikelyBot("Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36")).toBe(false);
  });
});

describe("rate", () => {
  it("shows a percentage, with a decimal for small ones", () => {
    expect(rate(1, 4)).toBe("25%");
    expect(rate(1, 40)).toBe("2.5%");
    expect(rate(0, 10)).toBe("0%");
  });

  it("has nothing to say without a base, and never exceeds 100%", () => {
    expect(rate(3, 0)).toBe("–");
    expect(rate(5, 4)).toBe("100%");
  });
});

describe("bucketDaily", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, "0")}`,
    searches: 1,
    booking_requests: i % 2,
  }));

  it("groups long periods into at most the requested number of bars", () => {
    const bars = bucketDaily(days, 14);
    expect(bars.length).toBeLessThanOrEqual(14);
    expect(bars.reduce((sum, bar) => sum + bar.searches, 0)).toBe(30);
    expect(bars.reduce((sum, bar) => sum + bar.booking_requests, 0)).toBe(15);
    expect(bars[0]!.label).toBe("2026-09-01 – 2026-09-03");
  });

  it("keeps short periods by day", () => {
    expect(bucketDaily(days.slice(0, 7), 14).map((bar) => bar.label)).toEqual(
      days.slice(0, 7).map((d) => d.day),
    );
    expect(bucketDaily([])).toEqual([]);
  });
});

describe("parsePeriod", () => {
  it("accepts known periods and falls back otherwise", () => {
    expect(parsePeriod("7d")).toBe("7d");
    expect(parsePeriod("forever")).toBe("30d");
    expect(parsePeriod(["7d"])).toBe("30d");
  });
});
