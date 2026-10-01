import { describe, expect, it } from "vitest";

import {
  adminBookingActionsFor,
  auditLabel,
  bookingStatusAfterDispute,
  canOpenDispute,
  formatBps,
  percentToBps,
  userStatusBlocker,
} from "./rules";
import { businessCommissionSchema, categorySchema, commissionSchema, disputeOpenSchema } from "./schemas";

const NOW = new Date("2026-10-02T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("admin booking actions", () => {
  it("offers complete and cancel only where the database allows them", () => {
    expect(adminBookingActionsFor("confirmed")).toEqual(["complete", "cancel"]);
    expect(adminBookingActionsFor("requested")).toEqual(["cancel"]);
    expect(adminBookingActionsFor("completed")).toEqual([]);
    expect(adminBookingActionsFor("disputed")).toEqual([]);
  });
});

describe("disputes", () => {
  it("can be opened on paid bookings, and up to 14 days after completion", () => {
    expect(canOpenDispute({ status: "confirmed", completed_at: null }, NOW)).toBe(true);
    expect(canOpenDispute({ status: "in_progress", completed_at: null }, NOW)).toBe(true);
    expect(canOpenDispute({ status: "completed", completed_at: daysAgo(13) }, NOW)).toBe(true);
    expect(canOpenDispute({ status: "completed", completed_at: daysAgo(15) }, NOW)).toBe(false);
    expect(canOpenDispute({ status: "requested", completed_at: null }, NOW)).toBe(false);
    expect(canOpenDispute({ status: "disputed", completed_at: null }, NOW)).toBe(false);
  });

  it("moves the booking according to the outcome", () => {
    expect(bookingStatusAfterDispute("business", "confirmed")).toBe("completed");
    expect(bookingStatusAfterDispute("customer", "completed")).toBe("cancelled");
    expect(bookingStatusAfterDispute("dismissed", "in_progress")).toBe("in_progress");
    expect(bookingStatusAfterDispute("dismissed", null)).toBe("completed");
  });

  it("needs a reason, a short summary and a description", () => {
    const valid = {
      bookingId: "6f8e2b1a-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
      reasonCode: "not_delivered",
      reason: "Job not finished",
      description: "The plumber left after an hour and the sink still leaks.",
    };
    expect(disputeOpenSchema.safeParse(valid).success).toBe(true);
    expect(disputeOpenSchema.safeParse({ ...valid, reason: "  " }).success).toBe(false);
    expect(disputeOpenSchema.safeParse({ ...valid, reasonCode: "made_up" }).success).toBe(false);
    expect(disputeOpenSchema.safeParse({ ...valid, description: "Bad." }).success).toBe(false);
  });
});

describe("commission", () => {
  it("parses percentages into basis points", () => {
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("12.5%")).toBe(1250);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("7.25")).toBe(725);
    expect(percentToBps("51")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
    expect(percentToBps("ten")).toBeNull();
  });

  it("formats basis points", () => {
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1250)).toBe("12.5%");
  });

  it("lets a business's custom rate be cleared", () => {
    const businessId = "6f8e2b1a-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(businessCommissionSchema.parse({ businessId, percent: "" }).percent).toBeNull();
    expect(businessCommissionSchema.parse({ businessId, percent: "8" }).percent).toBe(800);
    expect(commissionSchema.safeParse({ percent: "" }).success).toBe(false);
  });
});

describe("users", () => {
  const target = { id: "b", role: "customer" as const, status: "active" as const };
  it("stops admins changing their own status", () => {
    expect(userStatusBlocker("b", target, "suspend")).toMatch(/your own/);
  });
  it("only suspends active accounts and only reactivates inactive ones", () => {
    expect(userStatusBlocker("a", target, "suspend")).toBeNull();
    expect(userStatusBlocker("a", target, "reactivate")).toMatch(/already active/);
    expect(userStatusBlocker("a", { ...target, status: "suspended" }, "reactivate")).toBeNull();
  });
});

describe("categories", () => {
  it("validates slugs and treats an empty parent as a main category", () => {
    const base = { name: "Event planning", isActive: true, parentId: "" };
    expect(categorySchema.parse(base).parentId).toBeNull();
    expect(categorySchema.safeParse({ ...base, slug: "Event Planning!" }).success).toBe(false);
    expect(categorySchema.parse({ ...base, slug: "event-planning" }).slug).toBe("event-planning");
  });
});

describe("audit labels", () => {
  it("reads naturally, with a fallback for unknown actions", () => {
    expect(auditLabel("business.approve")).toBe("Approved a business");
    expect(auditLabel("something.new_thing")).toBe("something new thing");
  });
});
