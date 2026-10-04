"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { adminHref } from "@/lib/auth/admin-path";
import type { FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { doneStatuses } from "@/lib/bookings/rules";
import { AppError, isAppError, logger } from "@/lib/errors";
import { refreshPayout, sendPayout } from "@/lib/payments/payouts";
import { createAdminClient } from "@/lib/supabase/admin";

const payoutIdSchema = z.guid();

/** The payout leaves the list it was in, so the result is shown on the list it moved to. */
const tabFor = { paid: "paid", processing: "processing", pending: "owed" } as const;
type Outcome = keyof typeof tabFor;

/** Sends one payout to the business's bank account. */
export async function sendPayoutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let status: Outcome;
  try {
    const admin = await requireRole("admin");
    const payoutId = payoutIdSchema.parse(formData.get("payoutId"));
    status = await sendPayout(payoutId);
    await recordAdminAction(admin, {
      action: "payout.send",
      targetType: "payouts",
      targetId: payoutId,
      metadata: { result: status },
    });
  } catch (error) {
    return toFormError(error, "We couldn't send the payout. Please try again.");
  }
  redirect(adminHref(`/payouts?status=${tabFor[status]}&notice=${status}`));
}

/** Asks the payment provider how a sent payout ended. */
export async function refreshPayoutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let status: Outcome;
  try {
    const admin = await requireRole("admin");
    const payoutId = payoutIdSchema.parse(formData.get("payoutId"));
    status = await refreshPayout(payoutId);
    await recordAdminAction(admin, {
      action: "payout.refresh",
      targetType: "payouts",
      targetId: payoutId,
      metadata: { result: status },
    });
  } catch (error) {
    return toFormError(error, "We couldn't check the payout. Please try again.");
  }
  if (status === "processing") return { status: "success", message: "Still processing at the bank." };
  redirect(adminHref(`/payouts?status=${tabFor[status]}&notice=${status}`));
}

/** Sends every payout that's ready: job done, no dispute, and a verified bank account on file. */
export async function sendAllReadyPayoutsAction(_prev: FormState): Promise<FormState> {
  let sent = 0;
  let failed = 0;
  try {
    const admin = await requireRole("admin");
    const db = createAdminClient();
    const { data, error } = await db
      .from("payouts")
      .select("id, amount_minor, business_id, bookings!inner(status)")
      .eq("status", "pending")
      .in("bookings.status", doneStatuses)
      .limit(100);
    if (error) throw new AppError("INTERNAL", "Could not load payouts.", { cause: error });
    const { data: accounts } = await db
      .from("business_payout_accounts")
      .select("business_id")
      .in("business_id", [...new Set((data ?? []).map((p) => p.business_id))]);
    const withAccount = new Set((accounts ?? []).map((a) => a.business_id));
    const ready = (data ?? []).filter((p) => withAccount.has(p.business_id));
    if (ready.length === 0) return { status: "error", message: "No payouts are ready to send." };

    let sentMinor = 0;
    for (const payout of ready) {
      try {
        const status = await sendPayout(payout.id);
        if (status === "pending") failed += 1;
        else {
          sent += 1;
          sentMinor += payout.amount_minor;
        }
      } catch (error) {
        failed += 1;
        if (!isAppError(error) || error.status >= 500)
          logger.error("Payout failed", { payoutId: payout.id, error });
      }
    }
    await recordAdminAction(admin, {
      action: "payout.send_all",
      targetType: "payouts",
      metadata: { sent, sentMinor, failed },
    });
  } catch (error) {
    return toFormError(error, "We couldn't send the payouts. Please try again.");
  }
  redirect(adminHref(`/payouts?status=${failed ? "owed" : "paid"}&notice=all&sent=${sent}&failed=${failed}`));
}
