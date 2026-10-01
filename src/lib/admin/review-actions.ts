"use server";

import { refresh } from "next/cache";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { removeReviewPhoto } from "@/lib/reviews/photos";
import { createAdminClient } from "@/lib/supabase/admin";

import { reviewModerationSchema, reviewPhotoRemovalSchema } from "./schemas";

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
      .update({ status: decision === "hide" ? "hidden" : "published", reported_at: null })
      .eq("id", reviewId)
      .eq("status", from)
      .select("id, customer_id, report_reason, businesses(name, owner_id)");
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
    if (decision === "hide") {
      await notify({
        userId: review.customer_id,
        type: "review.hidden",
        title: "Your review was hidden",
        body: `Your review of ${review.businesses?.name ?? "a business"} breaks our guidelines: ${reason}`,
      });
      if (review.report_reason && review.businesses?.owner_id)
        await notify({
          userId: review.businesses.owner_id,
          type: "review.report_resolved",
          title: "The review you reported was hidden",
          body: "It no longer shows on your profile or counts towards your rating.",
          data: { reviewId: review.id },
        });
    }
  } catch (error) {
    return toFormError(error, "We couldn't update the review. Please try again.");
  }
  refresh();
  return { status: "success", message: decision === "hide" ? "Review hidden." : "Review published." };
}

/** Keeps a review a business reported: it stays published and the business is told. */
export async function dismissReviewReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = reviewModerationSchema.safeParse({
      reviewId: formData.get("reviewId"),
      reason: formData.get("reason") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { reviewId, reason } = parsed.data;

    const { data, error } = await createAdminClient()
      .from("reviews")
      .update({ reported_at: null })
      .eq("id", reviewId)
      .not("reported_at", "is", null)
      .select("id, businesses(name, owner_id)");
    if (error) throw new AppError("INTERNAL", "Could not update the review.", { cause: error });
    const review = data?.[0];
    if (!review)
      throw new AppError("CONFLICT", "This report was already handled. Refresh to see the latest.");

    await recordAdminAction(admin, {
      action: "review.report_dismissed",
      targetType: "reviews",
      targetId: review.id,
      reason,
      metadata: { business: review.businesses?.name ?? null },
    });
    if (review.businesses?.owner_id)
      await notify({
        userId: review.businesses.owner_id,
        type: "review.report_resolved",
        title: "The review you reported stays up",
        body: reason
          ? `We checked it against the guidelines: ${reason}`
          : "We checked it against the review guidelines and it doesn't break them. You can still reply to it.",
        data: { reviewId: review.id },
      });
  } catch (error) {
    return toFormError(error, "We couldn't update the review. Please try again.");
  }
  refresh();
  return { status: "success", message: "Report closed. The review stays up." };
}

/** Removes one photo from a review (the rest of the review stays) and tells the reviewer why. */
export async function removeReviewPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = reviewPhotoRemovalSchema.safeParse({
      photoId: formData.get("photoId"),
      reason: formData.get("reason") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { photoId, reason } = parsed.data;
    if (!reason)
      return { status: "error", fieldErrors: { reason: "Give a reason. The reviewer will see it." } };

    const reviewId = await removeReviewPhoto(photoId);
    if (!reviewId) throw new AppError("CONFLICT", "This photo was already removed.");
    const { data: review } = await createAdminClient()
      .from("reviews")
      .select("customer_id, businesses(name)")
      .eq("id", reviewId)
      .maybeSingle();

    await recordAdminAction(admin, {
      action: "review.photo_removed",
      targetType: "reviews",
      targetId: reviewId,
      reason,
      metadata: { photoId },
    });
    if (review)
      await notify({
        userId: review.customer_id,
        type: "review.photo_removed",
        title: "A photo was removed from your review",
        body: `A photo in your review of ${review.businesses?.name ?? "a business"} breaks our guidelines: ${reason}`,
      });
  } catch (error) {
    return toFormError(error, "We couldn't remove the photo. Please try again.");
  }
  refresh();
  return { status: "success", message: "Photo removed." };
}
