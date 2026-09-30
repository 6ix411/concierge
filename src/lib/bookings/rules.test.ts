import { describe, expect, it } from "vitest";

import { canCustomerCancel, canCustomerReschedule, isWithinAvailability, priceBooking } from "./rules";

const now = new Date("2026-10-01T09:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 36e5).toISOString();

describe("cancellation rules", () => {
  it("allows cancelling before payment at any time", () => {
    expect(canCustomerCancel({ status: "accepted", scheduled_start: inHours(1) }, now)).toBe(true);
  });
  it("allows cancelling a paid booking only 24h+ ahead", () => {
    expect(canCustomerCancel({ status: "confirmed", scheduled_start: inHours(30) }, now)).toBe(true);
    expect(canCustomerCancel({ status: "confirmed", scheduled_start: inHours(5) }, now)).toBe(false);
  });
  it("never allows cancelling finished bookings", () => {
    expect(canCustomerCancel({ status: "completed", scheduled_start: null }, now)).toBe(false);
  });
  it("lets customers reschedule only before acceptance", () => {
    expect(canCustomerReschedule({ status: "requested", scheduled_start: null })).toBe(true);
    expect(canCustomerReschedule({ status: "confirmed", scheduled_start: null })).toBe(false);
  });
});

describe("priceBooking", () => {
  const services = [
    { id: "a", name: "Decor", pricing_type: "fixed" as const, price_minor: 120000000 },
    { id: "b", name: "Plumber", pricing_type: "hourly" as const, price_minor: 800000 },
    { id: "c", name: "Custom", pricing_type: "quote_only" as const, price_minor: null },
  ];

  it("prices from server-side service data", () => {
    const quote = priceBooking(services, [
      { serviceId: "a", quantity: 1 },
      { serviceId: "b", quantity: 3 },
    ]);
    expect(quote.subtotalMinor).toBe(122400000);
    expect(quote.totalMinor).toBe(quote.subtotalMinor);
    expect(quote.needsQuote).toBe(false);
  });

  it("flags services that need a quote", () => {
    expect(priceBooking(services, [{ serviceId: "c", quantity: 1 }]).needsQuote).toBe(true);
  });

  it("rejects unknown services and silly quantities", () => {
    expect(() => priceBooking(services, [{ serviceId: "zzz", quantity: 1 }])).toThrow();
    expect(() => priceBooking(services, [{ serviceId: "a", quantity: 0 }])).toThrow();
    expect(() => priceBooking(services, [{ serviceId: "a", quantity: 1.5 }])).toThrow();
  });
});

describe("isWithinAvailability", () => {
  const rules = [
    { day_of_week: 3, specific_date: null, start_time: "08:00:00", end_time: "18:00:00", is_available: true },
    { day_of_week: null, specific_date: "2026-10-14", start_time: null, end_time: null, is_available: false },
  ];
  it("uses weekly rules", () => {
    expect(isWithinAvailability(rules, "2026-10-07", "10:00")).toBe(true); // Wednesday
    expect(isWithinAvailability(rules, "2026-10-07", "18:00")).toBe(false);
    expect(isWithinAvailability(rules, "2026-10-08", "10:00")).toBe(false); // Thursday
  });
  it("lets date overrides win", () => {
    expect(isWithinAvailability(rules, "2026-10-14", "10:00")).toBe(false);
  });
});
