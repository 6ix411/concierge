import type { Metadata } from "next";
import Link from "next/link";

import { Stars } from "@/components/marketplace/rating";
import { EmptyState, LinkButton } from "@/components/ui";
import { requireAreaAccess } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { doneStatuses } from "@/lib/bookings/rules";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My reviews" };

export default async function MyReviewsPage() {
  const user = await requireAreaAccess("account");
  const supabase = await createClient();
  const [{ data: reviews }, { data: toReview }] = await Promise.all([
    supabase
      .from("reviews")
      .select("id, rating, comment, business_reply, created_at, booking_id, businesses(name, slug)")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("id, reference, businesses(name), reviews(id)")
      .eq("customer_id", user.id)
      .in("status", doneStatuses)
      .order("completed_at", { ascending: false })
      .limit(20),
  ]);
  const pending = (toReview ?? []).filter((booking) => !booking.reviews);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
      {pending.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Waiting for your review</h2>
          <ul className="flex flex-col gap-2">
            {pending.map((booking) => (
              <li
                key={booking.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4"
              >
                <span className="text-sm">
                  <span className="font-medium">{booking.businesses?.name}</span>
                  <span className="text-muted"> · {booking.reference}</span>
                </span>
                <LinkButton href={`/account/bookings/${booking.id}/review`} size="sm" variant="accent">
                  Review
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Your reviews</h2>
        {reviews && reviews.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/businesses/${review.businesses?.slug}`}
                    className="font-medium hover:underline"
                  >
                    {review.businesses?.name}
                  </Link>
                  <span className="text-xs text-muted">{formatDate(review.created_at)}</span>
                </div>
                <div className="mt-1">
                  <Stars value={review.rating} />
                </div>
                {review.comment && <p className="mt-2 text-sm">{review.comment}</p>}
                {review.business_reply && (
                  <p className="mt-3 rounded-xl bg-surface-muted p-3 text-sm text-muted">
                    <span className="font-medium text-foreground">Reply: </span>
                    {review.business_reply}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No reviews yet"
            description="After a completed booking, you can rate the business here."
          />
        )}
      </section>
    </div>
  );
}
