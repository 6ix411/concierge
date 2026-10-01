"use server";

import { refresh } from "next/cache";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { requireOwnBusinessForAction, toFormError } from "./action-utils";
import { reviewReplySchema } from "./schemas";

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
