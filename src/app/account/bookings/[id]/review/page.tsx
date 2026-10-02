import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ReviewForm } from "@/components/bookings/review-form";
import { requireAreaAccess } from "@/lib/auth/session";
import { getCustomerBooking } from "@/lib/bookings/queries";
import { canReview } from "@/lib/bookings/rules";
import { pageId } from "@/lib/security/ids";

export const metadata: Metadata = { title: "Leave a review" };

export default async function ReviewPage({ params }: PageProps<"/account/bookings/[id]/review">) {
  const user = await requireAreaAccess("account");
  const id = pageId((await params).id);
  const booking = await getCustomerBooking(user.id, id);
  if (!booking) notFound();
  if (!canReview({ ...booking, hasReview: Boolean(booking.reviews) })) redirect(`/account/bookings/${id}`);

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review {booking.businesses?.name}</h1>
        <p className="mt-1 text-muted">
          Your review appears on their profile with your first name and last initial.
        </p>
      </div>
      <ReviewForm bookingId={booking.id} />
    </div>
  );
}
