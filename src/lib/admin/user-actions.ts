"use server";

import { refreshPage } from "@/lib/utils/refresh";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { userStatusBlocker, type UserStatusDecision } from "./rules";
import { userStatusSchema } from "./schemas";

/**
 * Suspends or reactivates an account. A suspended user is signed out of every area and can't act.
 * Suspending a business owner also takes their live business off the marketplace.
 */
export async function setUserStatusAction(
  decision: UserStatusDecision,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let message = decision === "suspend" ? "Account suspended." : "Account reactivated.";
  try {
    const admin = await requireRole("admin");
    const parsed = userStatusSchema.safeParse({
      userId: formData.get("userId"),
      reason: formData.get("reason") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { userId, reason } = parsed.data;
    if (decision === "suspend" && !reason)
      return { status: "error", fieldErrors: { reason: "Give a reason for the audit log." } };

    const db = createAdminClient();
    const { data: target } = await db
      .from("users")
      .select("id, role, status, email")
      .eq("id", userId)
      .maybeSingle();
    if (!target) throw new AppError("NOT_FOUND", "User not found.");
    const blocker = userStatusBlocker(admin.id, target, decision);
    if (blocker) throw new AppError("CONFLICT", blocker);

    const { data, error } = await db
      .from("users")
      .update({ status: decision === "suspend" ? "suspended" : "active" })
      .eq("id", target.id)
      .eq("status", target.status)
      .select("id");
    if (error) throw new AppError("INTERNAL", "Could not update the account.", { cause: error });
    if (!data?.length) throw new AppError("CONFLICT", "This account changed. Refresh to see the latest.");

    let suspendedBusiness: string | null = null;
    if (decision === "suspend" && target.role === "business") {
      const { data: businesses } = await db
        .from("businesses")
        .update({ status: "suspended", status_reason: "The owner's account is suspended." })
        .eq("owner_id", target.id)
        .eq("status", "approved")
        .select("id, name");
      const business = businesses?.[0];
      if (business) {
        suspendedBusiness = business.name;
        await recordAdminAction(admin, {
          action: "business.suspend",
          targetType: "businesses",
          targetId: business.id,
          reason: "The owner's account is suspended.",
        });
        message = `Account suspended. ${business.name} is no longer listed.`;
      }
    }

    await recordAdminAction(admin, {
      action: `user.${decision}`,
      targetType: "users",
      targetId: target.id,
      reason,
      metadata: { email: target.email, role: target.role, suspendedBusiness },
    });
    if (decision === "reactivate")
      await notify({
        userId: target.id,
        type: "account.reactivated",
        title: "Your account is active again",
        body: "You can use Concierge as normal.",
      });
  } catch (error) {
    return toFormError(error, "We couldn't update the account. Please try again.");
  }
  refreshPage();
  return { status: "success", message };
}
