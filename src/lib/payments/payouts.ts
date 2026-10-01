import "server-only";

import { doneStatuses } from "@/lib/bookings/rules";
import { AppError, logger } from "@/lib/errors";
import { formatNaira } from "@/lib/format";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { getPaymentProvider } from "./index";
import type { TransferResult } from "./types";

/** Our transfer reference. A new one per attempt after a failure, so a retry is never mistaken for the old transfer. */
export function payoutReference(payoutId: string, attempt: number): string {
  return `PO-${payoutId.replaceAll("-", "").slice(0, 16).toUpperCase()}-${attempt}`;
}

/**
 * Verifies a business's bank account with the payment provider and saves it as where its payouts go.
 * The account name comes from the bank, never from what the business typed.
 */
export async function savePayoutAccount(input: {
  businessId: string;
  userId: string;
  bankCode: string;
  accountNumber: string;
}): Promise<{ accountName: string; bankName: string }> {
  const provider = getPaymentProvider();
  const banks = await provider.listBanks();
  const bank = banks.find((b) => b.code === input.bankCode);
  if (!bank) throw new AppError("VALIDATION_FAILED", "Choose your bank from the list.");

  let accountName: string;
  try {
    ({ accountName } = await provider.resolveAccount({
      accountNumber: input.accountNumber,
      bankCode: bank.code,
    }));
  } catch (error) {
    logger.warn("Bank account could not be resolved", { error });
    throw new AppError("VALIDATION_FAILED", "We couldn't find that account. Check the number and the bank.");
  }
  const { recipientCode } = await provider.createRecipient({
    accountNumber: input.accountNumber,
    bankCode: bank.code,
    accountName,
  });

  const { error } = await createAdminClient().from("business_payout_accounts").upsert({
    business_id: input.businessId,
    provider: provider.name,
    bank_code: bank.code,
    bank_name: bank.name,
    account_number: input.accountNumber,
    account_name: accountName,
    recipient_code: recipientCode,
    verified_at: new Date().toISOString(),
    updated_by: input.userId,
  });
  if (error) throw new AppError("INTERNAL", "Could not save the bank account.", { cause: error });
  return { accountName, bankName: bank.name };
}

/**
 * Sends a business its share of a completed booking. Only a pending payout for a finished job can be
 * sent, and claiming it (pending → processing) happens before any money moves, so two clicks never
 * pay twice. Returns the payout's status afterwards.
 */
export async function sendPayout(payoutId: string): Promise<"paid" | "processing" | "pending"> {
  const db = createAdminClient();
  const { data: payout } = await db
    .from("payouts")
    .select("id, status, amount_minor, attempts, reference, business_id, bookings(reference, status)")
    .eq("id", payoutId)
    .maybeSingle();
  if (!payout) throw new AppError("NOT_FOUND", "Payout not found.");
  if (payout.status !== "pending") throw new AppError("CONFLICT", "This payout isn't ready to send.");
  if (!payout.bookings || !doneStatuses.includes(payout.bookings.status))
    throw new AppError("CONFLICT", "The job hasn't been completed.");

  const { data: account } = await db
    .from("business_payout_accounts")
    .select("provider, bank_code, bank_name, account_number, recipient_code")
    .eq("business_id", payout.business_id)
    .maybeSingle();
  if (!account) throw new AppError("CONFLICT", "The business hasn't added a bank account yet.");
  const provider = getPaymentProvider();
  if (account.provider !== provider.name)
    throw new AppError("CONFLICT", "The business needs to save its bank account again.");

  const attempt = payout.attempts + 1;
  const reference = payout.reference ?? payoutReference(payout.id, attempt);
  const { data: claimed } = await db
    .from("payouts")
    .update({
      status: "processing",
      reference,
      attempts: attempt,
      provider: provider.name,
      sent_at: new Date().toISOString(),
      bank_name: account.bank_name,
      account_number_last4: account.account_number.slice(-4),
      failure_reason: null,
    })
    .eq("id", payout.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) throw new AppError("CONFLICT", "This payout is already being sent.");

  let result: TransferResult;
  try {
    result = await provider.transfer({
      reference,
      amount: { amountMinor: payout.amount_minor, currency: "NGN" },
      recipientCode: account.recipient_code,
      accountNumber: account.account_number,
      bankCode: account.bank_code,
      reason: `Concierge payout for ${payout.bookings.reference}`,
    });
  } catch (error) {
    // We can't tell whether the transfer went out. It stays processing until its status is checked;
    // a resend reuses the same reference, which the provider refuses to pay twice.
    logger.error("Payout transfer errored", { payoutId, reference, error });
    throw new AppError("INTERNAL", "We couldn't confirm the transfer. Check its status in a moment.", {
      cause: error,
    });
  }
  return applyTransferResult(payout.id, result);
}

/** Asks the provider how a sent payout ended (also used when a transfer webhook arrives). */
export async function refreshPayout(payoutId: string): Promise<"paid" | "processing" | "pending"> {
  const db = createAdminClient();
  const { data: payout } = await db
    .from("payouts")
    .select("id, status, reference, provider_reference, provider")
    .eq("id", payoutId)
    .maybeSingle();
  if (!payout) throw new AppError("NOT_FOUND", "Payout not found.");
  if (payout.status === "paid") return "paid";
  if (payout.status !== "processing" || !payout.reference || !payout.provider)
    throw new AppError("CONFLICT", "This payout hasn't been sent.");

  let result: TransferResult;
  try {
    result = await getPaymentProvider(payout.provider).verifyTransfer({
      reference: payout.reference,
      providerReference: payout.provider_reference,
    });
  } catch (error) {
    // The provider has no transfer with this reference, so nothing was sent. It can be sent again with the same reference.
    logger.warn("Payout transfer not found at the provider", { payoutId, error });
    await db
      .from("payouts")
      .update({ status: "pending", failure_reason: "The transfer didn't go through. Send it again." })
      .eq("id", payout.id)
      .eq("status", "processing");
    return "pending";
  }
  return applyTransferResult(payout.id, result);
}

/** A transfer webhook arrived: look the payout up by our reference and check it with the provider. */
export async function refreshPayoutByReference(reference: string): Promise<void> {
  const { data: payout } = await createAdminClient()
    .from("payouts")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();
  if (!payout) throw new AppError("NOT_FOUND", "Payout not found.");
  await refreshPayout(payout.id);
}

async function applyTransferResult(
  payoutId: string,
  result: TransferResult,
): Promise<"paid" | "processing" | "pending"> {
  const db = createAdminClient();
  if (result.status === "pending") {
    await db.from("payouts").update({ provider_reference: result.providerReference }).eq("id", payoutId);
    return "processing";
  }
  if (result.status === "failed") {
    // Back to pending with a fresh reference next time, so it can be sent again.
    await db
      .from("payouts")
      .update({
        status: "pending",
        reference: null,
        provider_reference: result.providerReference,
        failure_reason: result.reason?.slice(0, 300) || "The bank transfer failed.",
      })
      .eq("id", payoutId)
      .eq("status", "processing");
    return "pending";
  }

  const { data: paid } = await db
    .from("payouts")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_reference: result.providerReference,
      failure_reason: null,
    })
    .eq("id", payoutId)
    .eq("status", "processing")
    .select("amount_minor, bank_name, account_number_last4, bookings(reference), businesses(owner_id)")
    .maybeSingle();
  if (paid?.businesses?.owner_id) {
    await notify({
      userId: paid.businesses.owner_id,
      type: "payout.paid",
      title: "Payout sent",
      body: `${formatNaira(paid.amount_minor)} for ${paid.bookings?.reference ?? "your booking"} was sent to ${paid.bank_name ?? "your bank"} ••${paid.account_number_last4 ?? ""}.`,
      data: { payoutId },
    });
  }
  return "paid";
}
