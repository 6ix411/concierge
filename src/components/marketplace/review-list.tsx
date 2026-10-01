import { formatDate } from "@/lib/format";
import type { PublicReview } from "@/lib/marketplace/queries";

import { Stars } from "./rating";
import { ReviewPhotos } from "./review-photos";

export function ReviewList({ reviews, businessName }: { reviews: PublicReview[]; businessName: string }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted">
        No reviews yet. Reviews come only from customers who completed a booking through Concierge.
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
          <ReviewPhotos urls={review.photo_urls} label={`Photo from ${review.reviewer_name}`} />
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

/** Average, review count and how many reviews gave each number of stars. */
export function RatingSummary({
  average,
  count,
  breakdown,
}: {
  average: number;
  count: number;
  /** Reviews with 1, 2, 3, 4 and 5 stars. */
  breakdown: number[];
}) {
  if (count === 0) return null;
  const total = breakdown.reduce((sum, n) => sum + n, 0) || 1;
  return (
    <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-col items-start gap-1">
        <p className="text-3xl font-semibold tabular-nums">{average.toFixed(1)}</p>
        <Stars value={Math.round(average)} />
        <p className="text-sm text-muted">
          {count} review{count === 1 ? "" : "s"}
        </p>
      </div>
      <dl className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
        {[5, 4, 3, 2, 1].map((stars) => {
          const n = breakdown[stars - 1] ?? 0;
          return (
            <div key={stars} className="flex items-center gap-2">
              <dt className="w-12 text-muted tabular-nums">{stars} star</dt>
              <dd className="flex flex-1 items-center gap-2">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(n / total) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right text-muted tabular-nums">{n}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
