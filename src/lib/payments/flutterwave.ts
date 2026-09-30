import "server-only";

import { AppError } from "@/lib/errors";

import type { PaymentProvider } from "./types";

/** Flutterwave adapter. Charge, verify and webhook logic arrive with the payments stage. */
export function createFlutterwaveProvider(
  secretKey: string,
  webhookHash: string | undefined,
): PaymentProvider {
  void secretKey;
  void webhookHash;
  const notYet = () => {
    throw new AppError("NOT_IMPLEMENTED", "Flutterwave payments are not enabled yet.");
  };
  return { name: "flutterwave", initialize: notYet, verify: notYet, verifyWebhookSignature: notYet };
}
