import { beforeEach, describe, expect, it, vi } from "vitest";

import { categoryLabel } from "./categories";
import { notificationTarget } from "./links";

type Delivery = {
  id: string;
  channel: string;
  attempts: number;
  notification: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    user: { id: string; email: string | null; phone: string | null; full_name: string | null } | null;
  } | null;
};

const db: { queued: Delivery[]; updates: { id: string; values: Record<string, unknown> }[] } = {
  queued: [],
  updates: [],
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let values: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        order: () => query,
        limit: async () => ({ data: db.queued, error: null }),
        update: (v: Record<string, unknown>) => {
          values = v;
          return query;
        },
        eq: (column: string, value: string) => {
          if (values && column === "id") db.updates.push({ id: value, values });
          return values ? Promise.resolve({ error: null }) : query;
        },
      };
      return query;
    },
  }),
}));

const { dispatchDeliveries } = await import("./channels");

describe("notificationTarget", () => {
  const n = (type: string, data: unknown = {}) => ({ type, data });

  it("sends customers and businesses to their own booking, dispute and chat pages", () => {
    expect(notificationTarget(n("booking.accepted", { bookingId: "b1" }), "customer")?.path).toBe(
      "/account/bookings/b1",
    );
    expect(notificationTarget(n("booking.requested", { bookingId: "b1" }), "business")?.path).toBe(
      "/business/bookings/b1",
    );
    expect(notificationTarget(n("payment.confirmed", { bookingId: "b1" }), "customer")?.path).toBe(
      "/account/bookings/b1",
    );
    expect(notificationTarget(n("booking.reminder", { bookingId: "b1" }), "business")?.path).toBe(
      "/business/bookings/b1",
    );
    expect(notificationTarget(n("dispute.under_review", { bookingId: "b1" }), "business")?.path).toBe(
      "/business/bookings/b1/dispute",
    );
    expect(notificationTarget(n("message.new", { conversationId: "c1" }), "customer")?.path).toBe(
      "/account/messages/c1",
    );
  });

  it("opens the review form for a review request", () => {
    expect(notificationTarget(n("review.request", { bookingId: "b1" }), "customer")?.path).toBe(
      "/account/bookings/b1/review",
    );
    expect(notificationTarget(n("review.new", { bookingId: "b1" }), "business")?.path).toBe(
      "/business/reviews",
    );
  });

  it("starts new people in the right place", () => {
    expect(notificationTarget(n("account.welcome"), "customer")?.path).toBe("/concierge");
    expect(notificationTarget(n("account.welcome"), "business")?.path).toBe("/business/setup");
    expect(notificationTarget(n("verification.approved"), "business")?.path).toBe("/business/verification");
  });

  it("keeps admin links relative so the private admin path is added by the server", () => {
    expect(notificationTarget(n("dispute.escalated", { disputeId: "d1" }), "admin")).toEqual({
      path: "disputes/d1",
      admin: true,
    });
    expect(notificationTarget(n("business.submitted", { businessId: "x" }), "admin")).toEqual({
      path: "businesses/x",
      admin: true,
    });
    expect(notificationTarget(n("booking.cancelled", { bookingId: "b1" }), "customer")?.admin).toBe(false);
  });

  it("ignores data that isn't an object and returns null when there is nowhere to go", () => {
    expect(notificationTarget(n("booking.accepted", ["b1"]), "customer")).toBeNull();
    expect(notificationTarget(n("booking.accepted", { bookingId: 7 }), "customer")).toBeNull();
    expect(notificationTarget(n("something.else"), "customer")).toBeNull();
  });
});

describe("categoryLabel", () => {
  it("names known categories and falls back for others", () => {
    expect(categoryLabel("booking")).toBe("Bookings");
    expect(categoryLabel("dispute")).toBe("Disputes");
    expect(categoryLabel("mystery")).toBe("Updates");
    expect(categoryLabel(null)).toBe("Updates");
  });
});

describe("dispatchDeliveries", () => {
  const user = { id: "u1", email: "ada@example.com", phone: null, full_name: "Ada" };
  const notification = { id: "n1", type: "booking.accepted", title: "Accepted", body: null, user };

  beforeEach(() => {
    db.queued = [];
    db.updates = [];
  });

  it("sends through the matching channel and marks it sent", async () => {
    db.queued = [{ id: "d1", channel: "email", attempts: 0, notification }];
    const send = vi.fn(async () => {});
    const result = await dispatchDeliveries({ email: { name: "email", send } });
    expect(send).toHaveBeenCalledWith(
      { id: "n1", type: "booking.accepted", title: "Accepted", body: null },
      { id: "u1", email: "ada@example.com", phone: null, fullName: "Ada" },
    );
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(db.updates[0]).toMatchObject({ id: "d1", values: { status: "sent", attempts: 1 } });
  });

  it("skips a channel that isn't set up", async () => {
    db.queued = [{ id: "d1", channel: "sms", attempts: 0, notification }];
    const result = await dispatchDeliveries({});
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(db.updates[0]).toMatchObject({ values: { status: "skipped", last_error: "Channel not set up" } });
  });

  it("retries a failed send, then gives up after five attempts", async () => {
    const send = vi.fn(async () => {
      throw new Error("Provider down");
    });
    db.queued = [
      { id: "d1", channel: "push", attempts: 0, notification },
      { id: "d2", channel: "push", attempts: 4, notification },
    ];
    const result = await dispatchDeliveries({ push: { name: "push", send } });
    expect(result).toEqual({ sent: 0, failed: 2, skipped: 0 });
    expect(db.updates[0]).toMatchObject({
      id: "d1",
      values: { status: "pending", attempts: 1, last_error: "Provider down" },
    });
    expect(db.updates[1]).toMatchObject({ id: "d2", values: { status: "failed", attempts: 5 } });
  });
});
