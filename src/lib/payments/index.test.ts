import { describe, expect, it } from "vitest";

import { getPaymentProvider } from "./index";

describe("getPaymentProvider", () => {
  it("defaults to Paystack", () => {
    expect(getPaymentProvider().name).toBe("paystack");
  });

  it("can select Flutterwave explicitly", () => {
    expect(getPaymentProvider("flutterwave").name).toBe("flutterwave");
  });
});
