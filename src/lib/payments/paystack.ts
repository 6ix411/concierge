import "server-only";

import { AppError } from "@/lib/errors";

import type { PaymentProvider } from "./types";

/** Paystack adapter. Charge, verify and webhook logic arrive with the payments stage. */
export function createPaystackProvider(secretKey: string): PaymentProvider {
  void secretKey;
  const notYet = () => {
    throw new AppError("NOT_IMPLEMENTED", "Paystack payments are not enabled yet.");
  };
  return { name: "paystack", initialize: notYet, verify: notYet, verifyWebhookSignature: notYet };
}
