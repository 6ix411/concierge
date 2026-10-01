import type { Metadata } from "next";

import { ReviewReplyForm } from "@/components/business/review-reply-form";
import { ReviewReportForm } from "@/components/business/review-report-form";
import { Stars } from "@/components/marketplace/rating";
import { ReviewPhotos } from "@/components/marketplace/review-photos";
import { EmptyState } from "@/components/ui";
import { requireOwnBusiness } from "@/lib/business/queries";
import { getCounterpartNames } from "@/lib/chat/queries";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { photosForReviews } from "@/lib/reviews/photos";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Reviews" };

export default async function BusinessReviewsPage() {
  const { business } = await requireOwnBusiness();
  // Server-side read scoped to the owner's business: it includes whether they reported a review.
  const { data, error } = await createAdminClient()
    .from("reviews")
    .select(
      "id, rating, comment, business_reply, created_at, status, reported_at, customer_id, bookings(reference)",
    )
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });
  if (error) throw new AppError("INTERNAL", "Could not load your reviews.", { cause: error });
  const reviews = data ?? [];
  const [names, photos] = await Promise.all([
    getCounterpartNames(reviews.map((r) => r.customer_id)),
    photosForReviews(reviews.map((r) => r.id)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
          <p className="mt-1 text-muted">
            Only customers with a completed booking can review you, once per booking. You can reply publicly,
            or report a review that breaks the guidelines.
          </p>
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
              <ReviewPhotos urls={(photos.get(review.id) ?? []).map((p) => p.url)} />
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
              <div className="flex flex-wrap items-start gap-2">
                <ReviewReplyForm reviewId={review.id} existing={review.business_reply} />
                {review.status === "published" &&
                  (review.reported_at ? (
                    <p className="py-1.5 text-sm text-muted">Reported. The Concierge team is checking it.</p>
                  ) : (
                    <ReviewReportForm reviewId={review.id} />
                  ))}
              </div>
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
