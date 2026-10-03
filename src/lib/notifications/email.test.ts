import { describe, expect, it, vi } from "vitest";

import { createResendChannel, renderEmail } from "./email";

const notification = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "booking.accepted",
  title: "Booking accepted: CB-1234",
  body: "Frames by Kemi accepted <your> booking. Pay to confirm it.",
};
const recipient = { id: "u1", email: "ada@example.com", phone: null, fullName: "Ada Obi" };

describe("renderEmail", () => {
  it("links to the notification, not to anything that skips sign-in", () => {
    const email = renderEmail(notification, recipient, "https://concierge.ng");
    expect(email.subject).toBe(notification.title);
    expect(email.text).toContain(`https://concierge.ng/notifications/go/${notification.id}`);
    expect(email.text.startsWith("Hi Ada,")).toBe(true);
  });

  it("escapes text in the HTML version", () => {
    const { html } = renderEmail(notification, recipient, "https://concierge.ng");
    expect(html).toContain("accepted &lt;your&gt; booking");
    expect(html).not.toContain("<your>");
  });
});

describe("Resend channel", () => {
  it("sends one email with the key on the server only and an idempotency key", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const channel = createResendChannel({
      apiKey: "re_key",
      from: "Concierge <hello@concierge.ng>",
      appUrl: "https://concierge.ng",
      fetch,
    });
    await channel.send(notification, recipient);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_key");
    expect(headers["idempotency-key"]).toBe(`notification-${notification.id}`);
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["ada@example.com"]);
    expect(body.from).toBe("Concierge <hello@concierge.ng>");
  });

  it("fails without the response body (so it is retried and nothing personal is logged)", async () => {
    const fetch = vi.fn(
      async () => new Response('{"message":"ada@example.com is invalid"}', { status: 422 }),
    );
    const channel = createResendChannel({ apiKey: "k", from: "a@b.ng", appUrl: "https://c.ng", fetch });
    await expect(channel.send(notification, recipient)).rejects.toThrow("Email provider answered 422");
  });

  it("skips people without an email address", async () => {
    const fetch = vi.fn();
    const channel = createResendChannel({ apiKey: "k", from: "a@b.ng", appUrl: "https://c.ng", fetch });
    await expect(channel.send(notification, { ...recipient, email: null })).rejects.toThrow(
      "No email address",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
