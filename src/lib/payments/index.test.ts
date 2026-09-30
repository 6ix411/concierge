import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";

import { getPaymentProvider } from "./index";

describe("getPaymentProvider", () => {
  it("defaults to Paystack", () => {
    expect(getPaymentProvider().name).toBe("paystack");
  });

  it("can select Flutterwave explicitly", () => {
    expect(getPaymentProvider("flutterwave").name).toBe("flutterwave");
  });

  it("does not pretend to charge before the payments stage", async () => {
    const provider = getPaymentProvider();
    expect(() =>
      provider.initialize({
        reference: "ref",
        amount: { amountMinor: 10_000, currency: "NGN" },
        customerEmail: "a@b.co",
        callbackUrl: "http://localhost:3000/cb",
      }),
    ).toThrow(AppError);
  });
});
