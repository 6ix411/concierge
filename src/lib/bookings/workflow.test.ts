import { describe, expect, it } from "vitest";

import { canCustomerCancel, canCustomerPay, canMessage, canReview, type BookingStatus } from "./rules";
import { resolveSelection, type SelectableService } from "./selection";
import {
  canTransition,
  describeActor,
  describeEvent,
  flowPosition,
  formatBookingLocation,
  mainFlow,
  transitions,
  type BookingEvent,
} from "./workflow";

const event = (overrides: Partial<BookingEvent>): BookingEvent => ({
  id: "e1",
  event: "status_changed",
  from_status: null,
  to_status: null,
  actor_role: "system",
  note: null,
  metadata: {},
  created_at: "2026-10-01T09:00:00Z",
  ...overrides,
});

describe("booking workflow", () => {
  it("follows requested → pending provider → accepted → payment pending → confirmed → in progress → completed → reviewed", () => {
    expect(mainFlow).toEqual([
      "requested",
      "pending_provider",
      "accepted",
      "payment_pending",
      "confirmed",
      "in_progress",
      "completed",
      "reviewed",
    ]);
    for (let i = 0; i < mainFlow.length - 1; i++) {
      expect(canTransition(mainFlow[i]!, mainFlow[i + 1]!)).toBe(true);
    }
  });

  it("does not skip steps", () => {
    expect(canTransition("pending_provider", "confirmed")).toBe(false);
    expect(canTransition("accepted", "confirmed")).toBe(false);
    expect(canTransition("requested", "accepted")).toBe(false);
    expect(canTransition("confirmed", "reviewed")).toBe(false);
  });

  it("has the additional states", () => {
    expect(canTransition("pending_provider", "declined")).toBe(true);
    expect(canTransition("payment_pending", "cancelled")).toBe(true);
    expect(canTransition("reviewed", "disputed")).toBe(true);
    expect(canTransition("cancelled", "refunded")).toBe(true);
    for (const final of ["declined", "expired", "refunded"] as BookingStatus[]) {
      expect(transitions[final]).toEqual([]);
    }
  });

  it("never moves into the retired quote_requested state", () => {
    for (const next of Object.values(transitions)) expect(next).not.toContain("quote_requested");
  });

  it("tracks progress along the main path, and where a booking stopped", () => {
    expect(flowPosition("pending_provider")).toBe(1);
    expect(flowPosition("quoted")).toBe(1);
    expect(flowPosition("reviewed")).toBe(7);
    expect(flowPosition("cancelled", ["requested", "pending_provider", "accepted"])).toBe(2);
    expect(
      flowPosition("refunded", [
        "requested",
        "pending_provider",
        "accepted",
        "payment_pending",
        "confirmed",
        "cancelled",
      ]),
    ).toBe(4);
  });
});

describe("customer rules on the new states", () => {
  const now = new Date("2026-10-01T09:00:00Z");
  it("lets customers pay when accepted, and retry while payment is pending", () => {
    expect(canCustomerPay({ status: "accepted", scheduled_start: null })).toBe(true);
    expect(canCustomerPay({ status: "payment_pending", scheduled_start: null })).toBe(true);
    expect(canCustomerPay({ status: "pending_provider", scheduled_start: null })).toBe(false);
  });
  it("lets customers cancel before payment completes", () => {
    for (const status of ["pending_provider", "payment_pending"] as BookingStatus[]) {
      expect(canCustomerCancel({ status, scheduled_start: null }, now)).toBe(true);
    }
    expect(canCustomerCancel({ status: "reviewed", scheduled_start: null }, now)).toBe(false);
  });
  it("keeps chat open after a review, and allows one review", () => {
    expect(canMessage({ status: "reviewed", scheduled_start: null })).toBe(true);
    expect(canReview({ status: "completed", scheduled_start: null, hasReview: false })).toBe(true);
    expect(canReview({ status: "reviewed", scheduled_start: null, hasReview: true })).toBe(false);
  });
});

describe("booking history", () => {
  it("describes each change in plain words", () => {
    expect(describeEvent(event({ event: "created", to_status: "requested" }))).toBe("Booking requested");
    expect(describeEvent(event({ from_status: "requested", to_status: "pending_provider" }))).toBe(
      "Sent to the business",
    );
    expect(
      describeEvent(
        event({ from_status: "pending_provider", to_status: "quoted", metadata: { total_minor: 5_000_000 } }),
      ),
    ).toBe("Quote sent: ₦50,000");
    expect(describeEvent(event({ from_status: "disputed", to_status: "completed" }))).toBe("Dispute closed");
    expect(describeEvent(event({ event: "rescheduled", metadata: { to: "2026-10-10T09:00:00Z" } }))).toMatch(
      /^Moved to /,
    );
  });

  it("names who made each change from the viewer's side", () => {
    const names = { customer: "Ada", business: "Lens & Light" };
    expect(describeActor("customer", "customer", names)).toBe("You");
    expect(describeActor("customer", "business", names)).toBe("Ada");
    expect(describeActor("business", "customer", names)).toBe("Lens & Light");
    expect(describeActor("admin", "customer", names)).toBe("Concierge team");
    expect(describeActor("system", "customer", names)).toBeNull();
  });
});

describe("resolveSelection", () => {
  const svc = (id: string, extra: Partial<SelectableService> = {}): SelectableService => ({
    id,
    name: id,
    pricing_type: "fixed",
    price_minor: 1000,
    is_package: false,
    is_addon: false,
    duration_minutes: 60,
    ...extra,
  });
  const services = [
    svc("11111111-1111-1111-1111-111111111111"),
    svc("22222222-2222-2222-2222-222222222222", { is_package: true }),
    svc("33333333-3333-3333-3333-333333333333", { is_addon: true }),
  ];
  const [service, pack, addon] = services.map((s) => s.id) as [string, string, string];

  it("accepts a package with add-ons", () => {
    const result = resolveSelection(services, { serviceIds: [addon], packageId: pack, quantities: {} });
    expect(result).toEqual({
      ok: true,
      lines: [
        { serviceId: pack, quantity: 1, kind: "package" },
        { serviceId: addon, quantity: 1, kind: "addon" },
      ],
    });
  });
  it("needs a service or package for add-ons", () => {
    expect(resolveSelection(services, { serviceIds: [addon], quantities: {} })).toMatchObject({
      ok: false,
      field: "serviceIds",
    });
  });
  it("rejects a service passed off as a package, and unknown ids", () => {
    expect(resolveSelection(services, { serviceIds: [], packageId: service, quantities: {} })).toMatchObject({
      ok: false,
      field: "packageId",
    });
    expect(resolveSelection(services, { serviceIds: [pack], quantities: {} })).toMatchObject({ ok: false });
    expect(
      resolveSelection(services, { serviceIds: ["44444444-4444-4444-4444-444444444444"], quantities: {} }),
    ).toMatchObject({ ok: false, field: null });
  });
});

describe("formatBookingLocation", () => {
  it("joins the parts without repeats", () => {
    expect(
      formatBookingLocation({
        address_line: "1 Admiralty Way",
        area: "Lekki",
        city: "Lagos",
        state: "Lagos",
      }),
    ).toBe("1 Admiralty Way, Lekki, Lagos");
  });
});
