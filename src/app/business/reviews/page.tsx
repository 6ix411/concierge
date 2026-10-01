import type { Metadata } from "next";

import { ReviewReplyForm } from "@/components/business/review-reply-form";
import { Stars } from "@/components/marketplace/rating";
import { EmptyState } from "@/components/ui";
import { requireOwnBusiness } from "@/lib/business/queries";
import { getCounterpartNames } from "@/lib/chat/queries";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reviews" };

export default async function BusinessReviewsPage() {
  const { business } = await requireOwnBusiness();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reviews")
    .select("id, rating, comment, business_reply, created_at, status, customer_id, bookings(reference)")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });
  if (error) throw new AppError("INTERNAL", "Could not load your reviews.", { cause: error });
  const reviews = data ?? [];
  const names = await getCounterpartNames(reviews.map((r) => r.customer_id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
          <p className="mt-1 text-muted">Reviews come from customers after a completed booking.</p>
        </div>
        {business.rating_count > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold">{Number(business.rating_avg).toFixed(1)}</span>
            <Stars value={Number(business.rating_avg)} />
            <span className="text-sm text-muted">({business.rating_count})</span>
          </div>
        )}
      </div>
      {reviews.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{names.get(review.customer_id) ?? "Customer"}</span>
                <span className="text-xs text-muted">{formatDate(review.created_at)}</span>
              </div>
              <Stars value={review.rating} />
              {review.comment && <p className="text-sm">{review.comment}</p>}
              <p className="text-xs text-muted">
                Booking {review.bookings?.reference}
                {review.status === "hidden" && " · Hidden by the Concierge team"}
              </p>
              {review.business_reply && (
                <p className="rounded-xl bg-surface-muted p-3 text-sm">
                  <span className="font-medium">Your reply: </span>
                  {review.business_reply}
                </p>
              )}
              <ReviewReplyForm reviewId={review.id} existing={review.business_reply} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No reviews yet"
          description="After you complete a booking, the customer can review you."
        />
      )}
    </div>
  );
}
