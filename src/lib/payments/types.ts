import type { PaymentProviderName } from "@/lib/env/schema";

/** Amounts are always integers in the currency's minor unit (kobo for NGN) to avoid float errors. */
export type Money = { amountMinor: number; currency: "NGN" };

export type InitializePaymentInput = {
  /** Our own unique reference, stored on the payment before redirecting. */
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
  /** The provider's own id for the transaction. */
  providerReference: string | null;
  channel: string | null;
};

export type Bank = { code: string; name: string };

export type TransferStatus = "pending" | "success" | "failed";

export type TransferResult = { status: TransferStatus; providerReference: string | null; reason?: string };

export type RefundResult = { status: "pending" | "processed" | "failed"; providerReference: string | null };

/** What a verified webhook tells us, in provider-neutral terms. The details are always re-checked. */
export type WebhookEvent =
  | { kind: "charge"; event: string; reference: string }
  | { kind: "transfer"; event: string; reference: string; status: TransferStatus; reason?: string }
  | { kind: "refund"; event: string; reference: string; status: "processed" | "failed" }
  | { kind: "ignored"; event: string; reference: string | null };

/** Every payment provider implements this, so bookings never depend on a specific gateway. */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Starts a hosted checkout for the customer. */
  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  /** Asks the provider, server to server, what really happened to a payment. */
  verify(reference: string): Promise<VerifyPaymentResult>;
  /** Checks a webhook's signature against the raw request body. */
  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean>;
  /** Reads a webhook body whose signature has already been checked. */
  parseWebhook(rawBody: string): WebhookEvent;

  /** Banks the provider can pay out to. */
  listBanks(): Promise<Bank[]>;
  /** The account holder's name, as the bank has it. */
  resolveAccount(input: { accountNumber: string; bankCode: string }): Promise<{ accountName: string }>;
  /** Registers a payout destination where the provider needs one first (Paystack). */
  createRecipient(input: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  }): Promise<{ recipientCode: string | null }>;
  /** Sends money from the platform balance to a business. */
  transfer(input: {
    reference: string;
    amount: Money;
    recipientCode: string | null;
    accountNumber: string;
    bankCode: string;
    reason: string;
  }): Promise<TransferResult>;
  verifyTransfer(input: { reference: string; providerReference: string | null }): Promise<TransferResult>;
  /** Refunds all or part of a successful payment to the customer. */
  refund(input: {
    reference: string;
    providerReference: string | null;
    amount: Money;
  }): Promise<RefundResult>;
}
