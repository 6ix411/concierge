import { formatDate } from "@/lib/format";
import type { PublicReview } from "@/lib/marketplace/queries";

import { Stars } from "./rating";

export function ReviewList({ reviews, businessName }: { reviews: PublicReview[]; businessName: string }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted">
        No reviews yet. Reviews come only from customers who booked through Concierge.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {reviews.map((review) => (
        <li key={review.id} className="border-b border-border pb-4 last:border-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{review.reviewer_name}</p>
            <p className="text-xs text-muted">{formatDate(review.created_at)}</p>
          </div>
          <div className="mt-1">
            <Stars value={review.rating} />
          </div>
          {review.comment && <p className="mt-2 text-sm leading-relaxed">{review.comment}</p>}
          {review.business_reply && (
            <div className="mt-3 rounded-xl bg-surface-muted p-3 text-sm">
              <p className="font-medium">Reply from {businessName}</p>
              <p className="mt-1 text-muted">{review.business_reply}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
