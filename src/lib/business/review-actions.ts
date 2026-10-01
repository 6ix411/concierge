"use server";

import { refresh } from "next/cache";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { requireOwnBusinessForAction, toFormError } from "./action-utils";
import { reviewReplySchema, reviewReportSchema } from "./schemas";

/** A public reply from the business under a review. Reviews themselves can't be edited by businesses. */
export async function replyToReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = reviewReplySchema.safeParse({
      reviewId: formData.get("reviewId"),
      reply: formData.get("reply"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

    // Row level security confirms the review is about this owner's business.
    const supabase = await createClient();
    const { data: review } = await supabase
      .from("reviews")
      .select("id, customer_id")
      .eq("id", parsed.data.reviewId)
      .eq("business_id", business.id)
      .maybeSingle();
    if (!review) throw new AppError("NOT_FOUND", "Review not found.");

    const { error } = await createAdminClient()
      .from("reviews")
      .update({ business_reply: parsed.data.reply, business_replied_at: new Date().toISOString() })
      .eq("id", review.id)
      .eq("business_id", business.id);
    if (error) throw new AppError("INTERNAL", "Could not save your reply.", { cause: error });

    await notify({
      userId: review.customer_id,
      type: "review.replied",
      title: `${business.name} replied to your review`,
      data: { reviewId: review.id },
    });
  } catch (error) {
    return toFormError(error, "We couldn't save your reply. Please try again.");
  }
  refresh();
  return { status: "success", message: "Reply posted." };
}

/**
 * Asks the Concierge team to look at a review the business thinks breaks the guidelines. The review
 * stays up until an admin decides; businesses can never edit or remove reviews themselves.
 */
export async function reportReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = reviewReportSchema.safeParse({
      reviewId: formData.get("reviewId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

    const db = createAdminClient();
    const { data, error } = await db
      .from("reviews")
      .update({ reported_at: new Date().toISOString(), report_reason: parsed.data.reason })
      .eq("id", parsed.data.reviewId)
      .eq("business_id", business.id)
      .eq("status", "published")
      .is("reported_at", null)
      .select("id");
    if (error) throw new AppError("INTERNAL", "Could not report the review.", { cause: error });
    if (!data?.length)
      return { status: "success", message: "The Concierge team already has this review to look at." };

    const { data: admins } = await db.from("users").select("id").eq("role", "admin").eq("status", "active");
    await notify(
      ...(admins ?? []).map((a) => ({
        userId: a.id,
        type: "review.reported",
        title: "A business reported a review",
        body: `${business.name} says a review breaks the guidelines.`,
        data: { reviewId: parsed.data.reviewId },
      })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't send your report. Please try again.");
  }
  refresh();
  return { status: "success", message: "Sent. The Concierge team will check it against the guidelines." };
}
