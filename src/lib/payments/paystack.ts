import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "@/lib/errors";

import { callProvider, type Fetch } from "./http";
import type { PaymentProvider, PaymentStatus, TransferStatus, WebhookEvent } from "./types";

const API = "https://api.paystack.co";

type Envelope<T> = { status: boolean; message: string; data: T };

const paymentStatus = (status: string): PaymentStatus =>
  status === "success"
    ? "success"
    : status === "abandoned"
      ? "abandoned"
      : status === "failed" || status === "reversed"
        ? "failed"
        : "pending";

const transferStatus = (status: string): TransferStatus =>
  status === "success"
    ? "success"
    : ["failed", "reversed", "rejected", "abandoned", "blocked"].includes(status)
      ? "failed"
      : "pending";

/**
 * Paystack (https://paystack.com/docs/api). Amounts are in kobo. Customers pay into the platform's
 * Paystack balance; businesses are paid with transfers to a saved recipient.
 */
export function createPaystackProvider(secretKey: string, fetchImpl: Fetch = fetch): PaymentProvider {
  const call = <T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }) =>
    callProvider<Envelope<T>>(fetchImpl, "Paystack", `${API}${path}`, secretKey, init).then((json) => {
      if (!json.status) throw new AppError("INTERNAL", `Paystack: ${json.message}`);
      return json.data;
    });

  return {
    name: "paystack",

    async initialize(input) {
      const data = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
        method: "POST",
        body: {
          email: input.customerEmail,
          amount: input.amount.amountMinor,
          currency: input.amount.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        },
      });
      return { provider: "paystack", reference: data.reference, authorizationUrl: data.authorization_url };
    },

    async verify(reference) {
      const data = await call<{
        id: number;
        status: string;
        reference: string;
        amount: number;
        currency: string;
        paid_at: string | null;
        channel: string | null;
      }>(`/transaction/verify/${encodeURIComponent(reference)}`);
      if (data.reference !== reference || data.currency !== "NGN") {
        return {
          provider: "paystack",
          reference,
          status: "failed",
          amount: { amountMinor: 0, currency: "NGN" },
          paidAt: null,
          providerReference: String(data.id),
          channel: data.channel,
        };
      }
      return {
        provider: "paystack",
        reference,
        status: paymentStatus(data.status),
        amount: { amountMinor: data.amount, currency: "NGN" },
        paidAt: data.paid_at ? new Date(data.paid_at) : null,
        providerReference: String(data.id),
        channel: data.channel,
      };
    },

    async verifyWebhookSignature(rawBody, headers) {
      const signature = headers.get("x-paystack-signature");
      if (!signature) return false;
      const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(signature, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    },

    parseWebhook(rawBody): WebhookEvent {
      const body = JSON.parse(rawBody) as {
        event: string;
        data?: {
          reference?: string;
          status?: string;
          reason?: string;
          transaction_reference?: string;
          transaction?: { reference?: string };
        };
      };
      const data = body.data ?? {};
      if (body.event === "charge.success" && data.reference)
        return { kind: "charge", event: body.event, reference: data.reference };
      if (body.event.startsWith("transfer.") && data.reference) {
        const status = body.event === "transfer.success" ? "success" : "failed";
        return {
          kind: "transfer",
          event: body.event,
          reference: data.reference,
          status,
          reason: data.reason,
        };
      }
      if (body.event.startsWith("refund.")) {
        const reference = data.transaction_reference ?? data.transaction?.reference ?? null;
        if (reference && (body.event === "refund.processed" || body.event === "refund.failed"))
          return {
            kind: "refund",
            event: body.event,
            reference,
            status: body.event === "refund.processed" ? "processed" : "failed",
          };
      }
      return { kind: "ignored", event: body.event, reference: data.reference ?? null };
    },

    async listBanks() {
      const data = await call<{ code: string; name: string; active?: boolean }[]>(
        "/bank?country=nigeria&currency=NGN",
      );
      return data.filter((bank) => bank.active !== false).map(({ code, name }) => ({ code, name }));
    },

    async resolveAccount({ accountNumber, bankCode }) {
      const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
      const data = await call<{ account_name: string }>(`/bank/resolve?${query}`);
      return { accountName: data.account_name };
    },

    async createRecipient({ accountNumber, bankCode, accountName }) {
      const data = await call<{ recipient_code: string }>("/transferrecipient", {
        method: "POST",
        body: {
          type: "nuban",
          name: accountName,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: "NGN",
        },
      });
      return { recipientCode: data.recipient_code };
    },

    async transfer(input) {
      if (!input.recipientCode)
        throw new AppError("CONFLICT", "This business's bank account needs to be saved again.");
      const data = await call<{ status: string; transfer_code: string; reason?: string }>("/transfer", {
        method: "POST",
        body: {
          source: "balance",
          amount: input.amount.amountMinor,
          currency: input.amount.currency,
          recipient: input.recipientCode,
          reference: input.reference,
          reason: input.reason,
        },
      });
      return {
        status: transferStatus(data.status),
        providerReference: data.transfer_code,
        reason: data.reason,
      };
    },

    async verifyTransfer({ reference }) {
      const data = await call<{ status: string; transfer_code: string; reason?: string }>(
        `/transfer/verify/${encodeURIComponent(reference)}`,
      );
      return {
        status: transferStatus(data.status),
        providerReference: data.transfer_code,
        reason: data.reason,
      };
    },

    async refund({ reference, amount }) {
      const data = await call<{ id: number; status: string }>("/refund", {
        method: "POST",
        body: { transaction: reference, amount: amount.amountMinor },
      });
      const status =
        data.status === "processed" ? "processed" : data.status === "failed" ? "failed" : "pending";
      return { status, providerReference: String(data.id) };
    },
  };
}
