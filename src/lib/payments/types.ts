import type { PaymentProviderName } from "@/lib/env/schema";

/** Amounts are always integers in the currency's minor unit (kobo for NGN) to avoid float errors. */
export type Money = { amountMinor: number; currency: "NGN" };

export type InitializePaymentInput = {
  /** Our own unique reference, stored on the booking before redirecting. */
  reference: string;
  amount: Money;
  customerEmail: string;
  callbackUrl: string;
  metadata?: Record<string, string>;
};

export type InitializePaymentResult = {
  provider: PaymentProviderName;
  reference: string;
  /** Hosted checkout page to send the customer to. */
  authorizationUrl: string;
};

export type PaymentStatus = "pending" | "success" | "failed" | "abandoned";

export type VerifyPaymentResult = {
  provider: PaymentProviderName;
  reference: string;
  status: PaymentStatus;
  amount: Money;
  paidAt: Date | null;
};

/** Every payment provider implements this, so bookings never depend on a specific gateway. */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verify(reference: string): Promise<VerifyPaymentResult>;
  /** Checks a webhook's signature against the raw request body. */
  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean>;
}
