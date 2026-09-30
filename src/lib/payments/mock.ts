import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import type { PaymentProvider } from "./types";

/**
 * Development/test provider: "checkout" goes straight back to our callback and every
 * payment verifies as successful. Refuses to run when APP_ENV=production.
 */
export function createMockProvider(appUrl: string, appEnv: string): PaymentProvider {
  const assertNotProduction = () => {
    if (appEnv === "production") throw new AppError("INTERNAL", "Mock payments are disabled in production.");
  };

  return {
    name: "mock",
    async initialize(input) {
      assertNotProduction();
      const callback = new URL("/api/payments/callback", appUrl);
      callback.searchParams.set("reference", input.reference);
      return { provider: "mock", reference: input.reference, authorizationUrl: callback.toString() };
    },
    async verify(reference) {
      assertNotProduction();
      const { data, error } = await createAdminClient()
        .from("payments")
        .select("amount_minor")
        .eq("reference", reference)
        .maybeSingle();
      if (error || !data) throw new AppError("NOT_FOUND", "Payment not found.");
      return {
        provider: "mock",
        reference,
        status: "success",
        amount: { amountMinor: data.amount_minor, currency: "NGN" },
        paidAt: new Date(),
      };
    },
    async verifyWebhookSignature() {
      assertNotProduction();
      return true;
    },
  };
}
