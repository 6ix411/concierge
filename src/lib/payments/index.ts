import "server-only";

import type { PaymentProviderName } from "@/lib/env/schema";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors";

import { createFlutterwaveProvider } from "./flutterwave";
import { createPaystackProvider } from "./paystack";
import type { PaymentProvider } from "./types";

export type * from "./types";

/** Returns the configured provider (PAYMENT_PROVIDER, Paystack by default) or a specific one. */
export function getPaymentProvider(name?: PaymentProviderName): PaymentProvider {
  const env = getServerEnv();
  const selected = name ?? env.PAYMENT_PROVIDER;

  switch (selected) {
    case "paystack":
      if (!env.PAYSTACK_SECRET_KEY) throw new AppError("INTERNAL", "Paystack is not configured.");
      return createPaystackProvider(env.PAYSTACK_SECRET_KEY);
    case "flutterwave":
      if (!env.FLUTTERWAVE_SECRET_KEY) throw new AppError("INTERNAL", "Flutterwave is not configured.");
      return createFlutterwaveProvider(env.FLUTTERWAVE_SECRET_KEY, env.FLUTTERWAVE_WEBHOOK_HASH);
  }
}
