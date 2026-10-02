import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import type { PaymentProvider } from "./types";

const mockBanks = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "50211", name: "Kuda Bank" },
  { code: "999992", name: "OPay" },
  { code: "033", name: "United Bank for Africa" },
  { code: "057", name: "Zenith Bank" },
];

/**
 * Development/test provider: "checkout" goes straight back to our callback, every
 * payment verifies as successful, and transfers and refunds complete at once. Refuses to run when APP_ENV=production.
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
      const db = createAdminClient();
      // Booking payments are PAY-…; businesses' payments for plans and placements are CHG-….
      const { data, error } = reference.startsWith("CHG-")
        ? await db.from("business_charges").select("amount_minor").eq("reference", reference).maybeSingle()
        : await db.from("payments").select("amount_minor").eq("reference", reference).maybeSingle();
      if (error || !data) throw new AppError("NOT_FOUND", "Payment not found.");
      return {
        provider: "mock",
        reference,
        status: "success",
        amount: { amountMinor: data.amount_minor, currency: "NGN" },
        paidAt: new Date(),
        providerReference: `MOCK-${reference}`,
        channel: "card",
      };
    },
    async verifyWebhookSignature() {
      assertNotProduction();
      return true;
    },
    parseWebhook(rawBody) {
      // Same shape as Paystack's, so tests can exercise the webhook route.
      const body = JSON.parse(rawBody) as { event: string; data?: { reference?: string; reason?: string } };
      const reference = body.data?.reference ?? null;
      if (body.event === "charge.success" && reference)
        return { kind: "charge", event: body.event, reference };
      if (body.event.startsWith("transfer.") && reference)
        return {
          kind: "transfer",
          event: body.event,
          reference,
          status: body.event === "transfer.success" ? "success" : "failed",
          reason: body.data?.reason,
        };
      if ((body.event === "refund.processed" || body.event === "refund.failed") && reference)
        return {
          kind: "refund",
          event: body.event,
          reference,
          status: body.event === "refund.processed" ? "processed" : "failed",
        };
      return { kind: "ignored", event: body.event, reference };
    },
    async listBanks() {
      assertNotProduction();
      return mockBanks;
    },
    async resolveAccount({ accountNumber }) {
      assertNotProduction();
      // Account numbers ending in 0000 don't exist, so the "not found" path can be tried.
      if (accountNumber.endsWith("0000")) throw new AppError("NOT_FOUND", "Account not found.");
      return { accountName: "DEMO BUSINESS ACCOUNT" };
    },
    async createRecipient({ accountNumber }) {
      assertNotProduction();
      return { recipientCode: `RCP_mock${accountNumber.slice(-4)}` };
    },
    async transfer({ reference }) {
      assertNotProduction();
      return { status: "success", providerReference: `TRF_${reference.slice(-12)}` };
    },
    async verifyTransfer({ reference }) {
      assertNotProduction();
      return { status: "success", providerReference: `TRF_${reference.slice(-12)}` };
    },
    async refund({ reference }) {
      assertNotProduction();
      return { status: "processed", providerReference: `RFD_${reference.slice(-12)}` };
    },
  };
}
