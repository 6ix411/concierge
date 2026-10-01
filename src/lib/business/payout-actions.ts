"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { savePayoutAccount } from "@/lib/payments/payouts";

import { requireOwnBusinessForAction, toFormError } from "./action-utils";

const payoutAccountSchema = z.object({
  bankCode: z.string({ error: "Choose your bank." }).trim().min(1, "Choose your bank.").max(20),
  accountNumber: z
    .string({ error: "Enter your account number." })
    .trim()
    .regex(/^\d{10}$/, "Enter the 10-digit account number (NUBAN)."),
});

/** Verifies the business's bank account with the payment provider and saves it for payouts. Owner only. */
export async function savePayoutAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    bankCode: String(formData.get("bankCode") ?? ""),
    accountNumber: String(formData.get("accountNumber") ?? "").replace(/\s/g, ""),
  };
  let message: string;
  try {
    const { user, business } = await requireOwnBusinessForAction();
    const parsed = payoutAccountSchema.safeParse(values);
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
    const { accountName, bankName } = await savePayoutAccount({
      businessId: business.id,
      userId: user.id,
      ...parsed.data,
    });
    message = `Saved. Payouts will go to ${accountName} at ${bankName}.`;
  } catch (error) {
    return { ...toFormError(error, "We couldn't save your bank account. Please try again."), values };
  }
  refresh();
  return { status: "success", message };
}
