"use server";

import { refresh } from "next/cache";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { reviewModerationSchema } from "./schemas";

/** Hides a review from the public (the business rating updates automatically), or publishes it again. */
export async function moderateReviewAction(
  decision: "hide" | "publish",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = reviewModerationSchema.safeParse({
      reviewId: formData.get("reviewId"),
      reason: formData.get("reason") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { reviewId, reason } = parsed.data;
    if (decision === "hide" && !reason)
      return { status: "error", fieldErrors: { reason: "Give a reason. The reviewer will see it." } };

    const from = decision === "hide" ? "published" : "hidden";
    const db = createAdminClient();
    const { data, error } = await db
      .from("reviews")
      .update({ status: decision === "hide" ? "hidden" : "published" })
      .eq("id", reviewId)
      .eq("status", from)
      .select("id, customer_id, businesses(name)");
    if (error) throw new AppError("INTERNAL", "Could not update the review.", { cause: error });
    const review = data?.[0];
    if (!review) throw new AppError("CONFLICT", "This review changed. Refresh to see the latest.");

    await recordAdminAction(admin, {
      action: `review.${decision}`,
      targetType: "reviews",
      targetId: review.id,
      reason,
      metadata: { business: review.businesses?.name ?? null },
    });
    if (decision === "hide")
      await notify({
        userId: review.customer_id,
        type: "review.hidden",
        title: "Your review was hidden",
        body: `Your review of ${review.businesses?.name ?? "a business"} breaks our guidelines: ${reason}`,
      });
  } catch (error) {
    return toFormError(error, "We couldn't update the review. Please try again.");
  }
  refresh();
  return { status: "success", message: decision === "hide" ? "Review hidden." : "Review published." };
}
