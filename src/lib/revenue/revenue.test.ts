import { describe, expect, it } from "vitest";

import { bookingFeeFor, NO_BOOKING_FEE, priceBooking } from "@/lib/bookings/rules";
import { compareMatches } from "@/lib/matching/explain";
import { match } from "@/lib/concierge/test-fixtures";
import { notificationTarget } from "@/lib/notifications/links";

import {
  bookingFeeSchema,
  checkoutSchema,
  CHARGE_REFERENCE,
  describeBookingFee,
  parseBookingFee,
  planPriceLabel,
  planSchema,
  storeBookingFee,
} from "./rules";

describe("customer booking fee", () => {
  const rule = { percentBps: 500, flatMinor: 500_00, capMinor: 5_000_00 };

  it("is a percentage plus a flat amount, capped", () => {
    expect(bookingFeeFor(20_000_00, rule)).toBe(1_000_00 + 500_00);
    expect(bookingFeeFor(1_000_000_00, rule)).toBe(5_000_00);
    expect(bookingFeeFor(20_000_00, { ...rule, capMinor: null })).toBe(1_500_00);
  });

  it("is never charged on a booking with no price yet, or when off", () => {
    expect(bookingFeeFor(0, rule)).toBe(0);
    expect(bookingFeeFor(20_000_00, NO_BOOKING_FEE)).toBe(0);
  });

  it("is added on top of the service price", () => {
    const quote = priceBooking(
      [{ id: "s1", name: "Decor", price_minor: 100_000_00, pricing_type: "fixed" }],
      [{ serviceId: "s1", quantity: 1 }],
      { percentBps: 250, flatMinor: 0, capMinor: null },
    );
    expect(quote).toMatchObject({
      subtotalMinor: 100_000_00,
      platformFeeMinor: 2_500_00,
      totalMinor: 102_500_00,
    });
  });

  it("reads a broken setting as no fee", () => {
    expect(parseBookingFee(null)).toEqual(NO_BOOKING_FEE);
    expect(parseBookingFee({ percent_bps: -1, flat_minor: 0, cap_minor: null })).toEqual(NO_BOOKING_FEE);
    expect(parseBookingFee(storeBookingFee(rule))).toEqual(rule);
  });

  it("describes itself in plain words", () => {
    expect(describeBookingFee(NO_BOOKING_FEE)).toBe("No booking fee");
    expect(describeBookingFee(rule)).toBe("5% + ₦500 (up to ₦5,000)");
  });

  it("validates the admin form", () => {
    expect(bookingFeeSchema.parse({ percent: "2.5", flat: "", cap: "" })).toEqual({
      percentBps: 250,
      flatMinor: 0,
      capMinor: null,
    });
    expect(bookingFeeSchema.safeParse({ percent: "25", flat: "", cap: "" }).success).toBe(false);
    expect(bookingFeeSchema.safeParse({ percent: "", flat: "1000", cap: "500" }).success).toBe(false);
  });
});

describe("plans and checkout", () => {
  it("validates plan edits", () => {
    const parsed = planSchema.parse({
      code: "starter",
      name: "Starter",
      price: "25,000",
      commission: "",
      perks: "One\n\n Two ",
      active: true,
    });
    expect(parsed).toMatchObject({ price: 25_000_00, commission: null, perks: ["One", "Two"] });
    expect(
      planSchema.safeParse({ ...parsed, code: "gold", price: "1", commission: "", perks: "" }).success,
    ).toBe(false);
  });

  it("only accepts known kinds and safe codes from the browser", () => {
    expect(checkoutSchema.safeParse({ kind: "featured", code: "week" }).success).toBe(true);
    expect(checkoutSchema.safeParse({ kind: "free_money", code: "week" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ kind: "subscription", code: "pro'; drop" }).success).toBe(false);
  });

  it("labels prices", () => {
    expect(planPriceLabel(0)).toBe("₦0/month");
    expect(planPriceLabel(25_000_00)).toBe("₦25,000/month");
  });

  it("keeps charge references apart from booking payments", () => {
    expect(CHARGE_REFERENCE.test("CHG-0123456789ABCDEF")).toBe(true);
    expect(CHARGE_REFERENCE.test("PAY-0123456789ABCDEF")).toBe(false);
  });

  it("sends billing notifications to the plan or featured page", () => {
    expect(notificationTarget({ type: "billing.plan_ending", data: {} }, "business")?.path).toBe(
      "/business/plan",
    );
    expect(notificationTarget({ type: "billing.featured_started", data: {} }, "business")?.path).toBe(
      "/business/promote",
    );
  });
});

describe("featured placement in display order", () => {
  it("puts providers the database lifted first, then best match", () => {
    const a = match({ id: "a", name: "A", score: 90 });
    const b = match({ id: "b", name: "B", score: 60, is_featured: true });
    const c = match({ id: "c", name: "C", score: 70 });
    expect([a, b, c].sort(compareMatches).map((m) => m.id)).toEqual(["b", "a", "c"]);
  });
});
