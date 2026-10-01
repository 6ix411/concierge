import "server-only";

import { timingSafeEqual } from "node:crypto";

import { AppError } from "@/lib/errors";

import { callProvider, toKobo, toNaira, type Fetch } from "./http";
import type { PaymentProvider, PaymentStatus, TransferStatus, WebhookEvent } from "./types";

const API = "https://api.flutterwave.com/v3";

type Envelope<T> = { status: string; message: string; data: T };

const paymentStatus = (status: string): PaymentStatus =>
  status === "successful"
    ? "success"
    : status === "failed"
      ? "failed"
      : status === "cancelled"
        ? "abandoned"
        : "pending";

const transferStatus = (status: string): TransferStatus =>
  status.toUpperCase() === "SUCCESSFUL"
    ? "success"
    : status.toUpperCase() === "FAILED"
      ? "failed"
      : "pending";

/**
 * Flutterwave (https://developer.flutterwave.com/reference). Amounts are in naira. Customers pay into
 * the platform's Flutterwave balance; businesses are paid with transfers straight to their account.
 */
export function createFlutterwaveProvider(
  secretKey: string,
  webhookHash: string | undefined,
  fetchImpl: Fetch = fetch,
): PaymentProvider {
  const call = <T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }) =>
    callProvider<Envelope<T>>(fetchImpl, "Flutterwave", `${API}${path}`, secretKey, init).then((json) => {
      if (json.status !== "success") throw new AppError("INTERNAL", `Flutterwave: ${json.message}`);
      return json.data;
    });

  return {
    name: "flutterwave",

    async initialize(input) {
      const data = await call<{ link: string }>("/payments", {
        method: "POST",
        body: {
          tx_ref: input.reference,
          amount: toNaira(input.amount.amountMinor),
          currency: input.amount.currency,
          redirect_url: input.callbackUrl,
          customer: { email: input.customerEmail },
          meta: input.metadata,
          customizations: { title: "Concierge by 6IX" },
        },
      });
      return { provider: "flutterwave", reference: input.reference, authorizationUrl: data.link };
    },

    async verify(reference) {
      const data = await call<{
        id: number;
        tx_ref: string;
        status: string;
        amount: number;
        currency: string;
        created_at: string | null;
        payment_type: string | null;
      }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
      const valid = data.tx_ref === reference && data.currency === "NGN";
      return {
        provider: "flutterwave",
        reference,
        status: valid ? paymentStatus(data.status) : "failed",
        amount: { amountMinor: valid ? toKobo(data.amount) : 0, currency: "NGN" },
        paidAt: data.status === "successful" && data.created_at ? new Date(data.created_at) : null,
        providerReference: String(data.id),
        channel: data.payment_type,
      };
    },

    async verifyWebhookSignature(_rawBody, headers) {
      // Flutterwave sends the secret hash set in its dashboard; compare in constant time.
      const sent = headers.get("verif-hash");
      if (!webhookHash || !sent) return false;
      const a = Buffer.from(webhookHash, "utf8");
      const b = Buffer.from(sent, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    },

    parseWebhook(rawBody): WebhookEvent {
      const body = JSON.parse(rawBody) as {
        event?: string;
        "event.type"?: string;
        data?: { tx_ref?: string; reference?: string; status?: string; complete_message?: string };
      };
      const event = body.event ?? body["event.type"] ?? "unknown";
      const data = body.data ?? {};
      if (event === "charge.completed" && data.tx_ref)
        return { kind: "charge", event, reference: data.tx_ref };
      if (event === "transfer.completed" && data.reference) {
        return {
          kind: "transfer",
          event,
          reference: data.reference,
          status: transferStatus(data.status ?? ""),
          reason: data.complete_message,
        };
      }
      return { kind: "ignored", event, reference: data.tx_ref ?? data.reference ?? null };
    },

    async listBanks() {
      const data = await call<{ code: string; name: string }[]>("/banks/NG");
      return data.map(({ code, name }) => ({ code, name }));
    },

    async resolveAccount({ accountNumber, bankCode }) {
      const data = await call<{ account_name: string }>("/accounts/resolve", {
        method: "POST",
        body: { account_number: accountNumber, account_bank: bankCode },
      });
      return { accountName: data.account_name };
    },

    async createRecipient() {
      // Flutterwave transfers go straight to an account number; there's nothing to register.
      return { recipientCode: null };
    },

    async transfer(input) {
      const data = await call<{ id: number; status: string; complete_message?: string }>("/transfers", {
        method: "POST",
        body: {
          account_bank: input.bankCode,
          account_number: input.accountNumber,
          amount: toNaira(input.amount.amountMinor),
          currency: input.amount.currency,
          debit_currency: "NGN",
          reference: input.reference,
          narration: input.reason,
        },
      });
      return {
        status: transferStatus(data.status),
        providerReference: String(data.id),
        reason: data.complete_message,
      };
    },

    async verifyTransfer({ providerReference }) {
      if (!providerReference) return { status: "pending", providerReference: null };
      const data = await call<{ id: number; status: string; complete_message?: string }>(
        `/transfers/${encodeURIComponent(providerReference)}`,
      );
      return {
        status: transferStatus(data.status),
        providerReference: String(data.id),
        reason: data.complete_message,
      };
    },

    async refund({ providerReference, amount }) {
      if (!providerReference)
        throw new AppError("CONFLICT", "This payment has no Flutterwave transaction to refund.");
      const data = await call<{ id: number; status: string }>(
        `/transactions/${encodeURIComponent(providerReference)}/refund`,
        { method: "POST", body: { amount: toNaira(amount.amountMinor) } },
      );
      const status =
        data.status === "completed" ? "processed" : data.status === "failed" ? "failed" : "pending";
      return { status, providerReference: String(data.id) };
    },
  };
}
