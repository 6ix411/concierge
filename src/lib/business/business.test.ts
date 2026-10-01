import { describe, expect, it } from "vitest";

import { decisionsFor } from "@/lib/admin/business-review";
import { checkBookingWindow } from "@/lib/bookings/rules";

import { businessBookingActions } from "./booking-rules";
import { commissionFor, monthlyEarnings, summarizeEarnings } from "./earnings";
import { missingSteps, nextStep, onboardingProgress, type OnboardingSnapshot } from "./onboarding";
import { nairaToKobo, normalizeNigerianPhone, serviceSchema } from "./schemas";
import { slugify, uniqueSlug } from "./slug";
import { canSubmitForReview, isPubliclyVisible } from "./status";

const complete: OnboardingSnapshot = {
  business: {
    name: "Lush Events",
    description: "Luxury wedding and event decoration across Lagos for 50 to 1,000 guests.",
    primary_category_id: "c1",
    phone: "+2348030000001",
    email: null,
    city: "Lekki",
    state: "Lagos",
    logo_path: "b1/brand/logo.png",
  },
  areaCount: 2,
  mainServiceCount: 1,
  openDayCount: 6,
  portfolioCount: 3,
  verificationCount: 1,
};

describe("onboarding", () => {
  it("is complete when every step has what it needs", () => {
    const progress = onboardingProgress(complete);
    expect(missingSteps(progress)).toEqual([]);
    expect(nextStep(progress)).toBeNull();
  });

  it("lists missing steps in order", () => {
    const progress = onboardingProgress({
      ...complete,
      business: { ...complete.business, description: "Too short", logo_path: null },
      mainServiceCount: 0,
    });
    expect(missingSteps(progress)).toEqual(["Business information", "Services and pricing", "Portfolio"]);
    expect(nextStep(progress)).toBe("details");
  });

  it("needs a phone or an email", () => {
    const progress = onboardingProgress({ ...complete, business: { ...complete.business, phone: null } });
    expect(progress.details).toBe(false);
  });
});

describe("business status", () => {
  it("only approved businesses are visible", () => {
    expect(isPubliclyVisible("approved")).toBe(true);
    for (const status of ["draft", "pending", "under_review", "rejected", "suspended"] as const)
      expect(isPubliclyVisible(status)).toBe(false);
  });

  it("owners can submit drafts and resubmit rejections only", () => {
    expect(canSubmitForReview("draft")).toBe(true);
    expect(canSubmitForReview("rejected")).toBe(true);
    expect(canSubmitForReview("pending")).toBe(false);
    expect(canSubmitForReview("suspended")).toBe(false);
  });

  it("offers admins the right decisions", () => {
    expect(decisionsFor("pending")).toEqual(["start_review", "approve", "reject"]);
    expect(decisionsFor("under_review")).toEqual(["approve", "reject"]);
    expect(decisionsFor("approved")).toEqual(["suspend"]);
    expect(decisionsFor("suspended")).toEqual(["reinstate"]);
    expect(decisionsFor("draft")).toEqual([]);
  });
});

describe("form parsing", () => {
  it("normalizes Nigerian phone numbers", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("+234 803-123-4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("2348031234567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("12345")).toBeNull();
  });

  it("converts naira to kobo", () => {
    expect(nairaToKobo("1,500,000")).toBe(150_000_000);
    expect(nairaToKobo("₦2500.50")).toBe(250_050);
    expect(nairaToKobo("abc")).toBeNull();
  });

  const base = { name: "Fog machine", kind: "addon", pricingType: "fixed", price: "150000", isActive: true };

  it("prices services in kobo and flags add-ons", () => {
    const parsed = serviceSchema.parse(base);
    expect(parsed.row).toMatchObject({ price_minor: 15_000_000, is_addon: true, is_package: false });
  });

  it("rejects add-ons without a set price and packages without contents", () => {
    expect(serviceSchema.safeParse({ ...base, pricingType: "quote_only", price: "" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...base, kind: "package", includes: "" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...base, kind: "package", includes: "Stage\nLights" }).success).toBe(
      true,
    );
  });

  it("stores no price for quote-only services", () => {
    const parsed = serviceSchema.parse({ ...base, kind: "service", pricingType: "quote_only", price: "" });
    expect(parsed.row.price_minor).toBeNull();
  });
});

describe("slugs", () => {
  it("makes readable, unique slugs", () => {
    expect(slugify("Lush Events Décor & Co.")).toBe("lush-events-decor-and-co");
    expect(uniqueSlug("lush", new Set(["lush", "lush-2"]))).toBe("lush-3");
  });
});

describe("business bookings", () => {
  it("offers the next steps for each status", () => {
    expect(businessBookingActions("pending_provider")).toEqual(["accept", "decline"]);
    expect(businessBookingActions("pending_provider", true)).toEqual(["quote", "decline"]);
    expect(businessBookingActions("payment_pending")).toEqual(["cancel"]);
    expect(businessBookingActions("confirmed")).toEqual(["start", "complete", "cancel"]);
    expect(businessBookingActions("completed")).toEqual([]);
    expect(businessBookingActions("reviewed")).toEqual([]);
  });

  it("enforces notice and booking window", () => {
    const now = new Date("2026-10-01T09:00:00Z");
    const rules = { min_notice_hours: 24, booking_window_days: 30 };
    expect(checkBookingWindow(rules, new Date("2026-10-01T20:00:00Z"), now)?.time).toMatch(/1 day’s notice/);
    expect(checkBookingWindow(rules, new Date("2026-10-03T09:00:00Z"), now)).toBeNull();
    expect(checkBookingWindow(rules, new Date("2026-12-01T09:00:00Z"), now)?.date).toMatch(/30 days/);
  });
});

describe("earnings", () => {
  const bookings = [
    {
      status: "completed" as const,
      total_minor: 100_000_00,
      commission_rate_bps: 1000,
      completed_at: "2026-09-15T10:00:00Z",
    },
    { status: "confirmed" as const, total_minor: 50_000_00, commission_rate_bps: 1000, completed_at: null },
    { status: "cancelled" as const, total_minor: 70_000_00, commission_rate_bps: 1000, completed_at: null },
  ];

  it("splits paid bookings into earned and upcoming, after commission", () => {
    expect(commissionFor(100_000_00, 1000)).toBe(10_000_00);
    const summary = summarizeEarnings(bookings, [
      { status: "paid", amount_minor: 40_000_00 },
      { status: "pending", amount_minor: 50_000_00 },
      { status: "failed", amount_minor: 1 },
    ]);
    expect(summary).toMatchObject({
      grossMinor: 150_000_00,
      commissionMinor: 15_000_00,
      earnedMinor: 90_000_00,
      upcomingMinor: 45_000_00,
      paidOutMinor: 40_000_00,
      awaitingPayoutMinor: 50_000_00,
      paidBookingCount: 2,
    });
  });

  it("groups completed earnings by Lagos month", () => {
    const months = monthlyEarnings(bookings, 2, new Date("2026-10-01T09:00:00Z"));
    expect(months).toEqual([
      { month: "2026-09", netMinor: 90_000_00 },
      { month: "2026-10", netMinor: 0 },
    ]);
  });
});
