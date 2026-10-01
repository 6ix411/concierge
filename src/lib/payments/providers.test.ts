// @vitest-environment node
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createFlutterwaveProvider } from "./flutterwave";
import { toKobo, toNaira } from "./http";
import { createPaystackProvider } from "./paystack";

type Call = { url: string; method: string; body: unknown; auth: string | null };

/** A fake provider API: answers each request from `routes` by path prefix and records what was sent. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization"),
    });
    const path = new URL(url).pathname + new URL(url).search;
    const match = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (!match) return new Response(JSON.stringify({ status: false, message: "not found" }), { status: 404 });
    return new Response(JSON.stringify(routes[match]), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const money = (amountMinor: number) => ({ amountMinor, currency: "NGN" as const });

describe("Paystack", () => {
  it("starts checkout in kobo with our reference and the secret key server-side", async () => {
    const api = fakeFetch({
      "/transaction/initialize": {
        status: true,
        message: "ok",
        data: { authorization_url: "https://checkout.paystack.com/abc", reference: "PAY-1" },
      },
    });
    const provider = createPaystackProvider("sk_test_secret", api.impl);
    const result = await provider.initialize({
      reference: "PAY-1",
      amount: money(2_750_000),
      customerEmail: "ada@example.com",
      callbackUrl: "https://concierge.ng/api/payments/callback",
    });
    expect(result.authorizationUrl).toBe("https://checkout.paystack.com/abc");
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      auth: "Bearer sk_test_secret",
      body: { amount: 2_750_000, currency: "NGN", reference: "PAY-1", email: "ada@example.com" },
    });
  });

  it("verifies a payment and reports the amount, channel and Paystack id", async () => {
    const api = fakeFetch({
      "/transaction/verify/PAY-1": {
        status: true,
        message: "ok",
        data: {
          id: 991,
          status: "success",
          reference: "PAY-1",
          amount: 2_750_000,
          currency: "NGN",
          paid_at: "2026-10-01T10:00:00Z",
          channel: "card",
        },
      },
    });
    const result = await createPaystackProvider("sk", api.impl).verify("PAY-1");
    expect(result).toMatchObject({
      status: "success",
      amount: money(2_750_000),
      providerReference: "991",
      channel: "card",
    });
  });

  it("never reports success for another reference or currency", async () => {
    const api = fakeFetch({
      "/transaction/verify/PAY-1": {
        status: true,
        message: "ok",
        data: {
          id: 1,
          status: "success",
          reference: "PAY-2",
          amount: 100,
          currency: "NGN",
          paid_at: null,
          channel: null,
        },
      },
    });
    expect((await createPaystackProvider("sk", api.impl).verify("PAY-1")).status).toBe("failed");
  });

  it("maps abandoned and pending checkouts", async () => {
    for (const [paystack, ours] of [
      ["abandoned", "abandoned"],
      ["ongoing", "pending"],
      ["failed", "failed"],
    ] as const) {
      const api = fakeFetch({
        "/transaction/verify/": {
          status: true,
          message: "ok",
          data: {
            id: 1,
            status: paystack,
            reference: "PAY-1",
            amount: 100,
            currency: "NGN",
            paid_at: null,
            channel: null,
          },
        },
      });
      expect((await createPaystackProvider("sk", api.impl).verify("PAY-1")).status).toBe(ours);
    }
  });

  it("accepts only webhooks signed with the secret key", async () => {
    const provider = createPaystackProvider("sk_test_secret");
    const body = JSON.stringify({ event: "charge.success", data: { reference: "PAY-1" } });
    const signed = createHmac("sha512", "sk_test_secret").update(body).digest("hex");
    expect(await provider.verifyWebhookSignature(body, new Headers({ "x-paystack-signature": signed }))).toBe(
      true,
    );
    const forged = createHmac("sha512", "wrong").update(body).digest("hex");
    expect(await provider.verifyWebhookSignature(body, new Headers({ "x-paystack-signature": forged }))).toBe(
      false,
    );
    expect(
      await provider.verifyWebhookSignature(`${body} `, new Headers({ "x-paystack-signature": signed })),
    ).toBe(false);
    expect(await provider.verifyWebhookSignature(body, new Headers())).toBe(false);
  });

  it("reads charge, transfer and refund webhooks", () => {
    const provider = createPaystackProvider("sk");
    const parse = (event: string, data: object) => provider.parseWebhook(JSON.stringify({ event, data }));
    expect(parse("charge.success", { reference: "PAY-1" })).toEqual({
      kind: "charge",
      event: "charge.success",
      reference: "PAY-1",
    });
    expect(parse("transfer.failed", { reference: "PO-1", reason: "Account closed" })).toMatchObject({
      kind: "transfer",
      status: "failed",
      reason: "Account closed",
    });
    expect(parse("refund.processed", { transaction_reference: "PAY-1" })).toMatchObject({
      kind: "refund",
      reference: "PAY-1",
      status: "processed",
    });
    expect(parse("subscription.create", {}).kind).toBe("ignored");
  });

  it("pays a business by transfer from the balance, to the saved recipient", async () => {
    const api = fakeFetch({
      "/transfer": { status: true, message: "ok", data: { status: "pending", transfer_code: "TRF_1" } },
    });
    const result = await createPaystackProvider("sk", api.impl).transfer({
      reference: "PO-ABC-1",
      amount: money(2_250_000),
      recipientCode: "RCP_1",
      accountNumber: "0123456789",
      bankCode: "058",
      reason: "Payout",
    });
    expect(result).toEqual({ status: "pending", providerReference: "TRF_1", reason: undefined });
    expect(api.calls[0]?.body).toMatchObject({
      source: "balance",
      amount: 2_250_000,
      recipient: "RCP_1",
      reference: "PO-ABC-1",
    });
  });

  it("refunds by our payment reference", async () => {
    const api = fakeFetch({
      "/refund": { status: true, message: "ok", data: { id: 55, status: "pending" } },
    });
    const result = await createPaystackProvider("sk", api.impl).refund({
      reference: "PAY-1",
      providerReference: "991",
      amount: money(100_000),
    });
    expect(result).toEqual({ status: "pending", providerReference: "55" });
    expect(api.calls[0]?.body).toEqual({ transaction: "PAY-1", amount: 100_000 });
  });

  it("surfaces Paystack errors without the secret key", async () => {
    const api = fakeFetch({});
    await expect(createPaystackProvider("sk_live_supersecret", api.impl).verify("PAY-1")).rejects.toThrow(
      /^(?!.*supersecret)/,
    );
  });
});

describe("Flutterwave", () => {
  it("starts checkout in naira", async () => {
    const api = fakeFetch({
      "/v3/payments": {
        status: "success",
        message: "ok",
        data: { link: "https://checkout.flutterwave.com/x" },
      },
    });
    const result = await createFlutterwaveProvider("FLWSECK", "hash", api.impl).initialize({
      reference: "PAY-1",
      amount: money(2_750_050),
      customerEmail: "ada@example.com",
      callbackUrl: "https://concierge.ng/api/payments/callback",
    });
    expect(result.authorizationUrl).toBe("https://checkout.flutterwave.com/x");
    expect(api.calls[0]?.body).toMatchObject({ tx_ref: "PAY-1", amount: 27_500.5, currency: "NGN" });
  });

  it("verifies by our reference and converts back to kobo", async () => {
    const api = fakeFetch({
      "/v3/transactions/verify_by_reference": {
        status: "success",
        message: "ok",
        data: {
          id: 7,
          tx_ref: "PAY-1",
          status: "successful",
          amount: 27_500.5,
          currency: "NGN",
          created_at: "2026-10-01T10:00:00Z",
          payment_type: "card",
        },
      },
    });
    const result = await createFlutterwaveProvider("FLWSECK", "hash", api.impl).verify("PAY-1");
    expect(result).toMatchObject({ status: "success", amount: money(2_750_050), providerReference: "7" });
  });

  it("checks the verif-hash header", async () => {
    const provider = createFlutterwaveProvider("FLWSECK", "my-hash");
    expect(await provider.verifyWebhookSignature("{}", new Headers({ "verif-hash": "my-hash" }))).toBe(true);
    expect(await provider.verifyWebhookSignature("{}", new Headers({ "verif-hash": "nope" }))).toBe(false);
    const unconfigured = createFlutterwaveProvider("FLWSECK", undefined);
    expect(await unconfigured.verifyWebhookSignature("{}", new Headers({ "verif-hash": "" }))).toBe(false);
  });
});

describe("amount conversion", () => {
  it("round-trips kobo and naira without float drift", () => {
    for (const kobo of [1, 99, 10_050, 2_750_050, 123_456_789]) expect(toKobo(toNaira(kobo))).toBe(kobo);
  });
});
