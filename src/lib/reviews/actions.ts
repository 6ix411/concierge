"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { canReview } from "@/lib/bookings/rules";
import { AppError, isAppError, logger } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { saveReviewPhotos } from "./photos";
import { reviewPhotosProblem, sniffImageType, type ReviewPhotoType } from "./rules";

const reviewSchema = z.object({
  bookingId: z.guid(),
  rating: z.coerce.number().int().min(1, "Choose a rating.").max(5),
  comment: z.string().trim().max(2000).optional(),
});

export async function submitReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let bookingId: string;
  try {
    const customer = await requireRole("customer");
    await enforceRateLimit("review.submit", customer.id);
    const parsed = reviewSchema.safeParse({
      bookingId: formData.get("bookingId"),
      rating: formData.get("rating") ?? 0,
      comment: formData.get("comment") || undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    bookingId = parsed.data.bookingId;

    // Optional photos: checked in full before anything is saved. An empty picker sends one empty file.
    const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    const photoProblem = reviewPhotosProblem(files);
    if (photoProblem) return { status: "error", fieldErrors: { photos: photoProblem } };
    const photos: { bytes: Uint8Array; type: ReviewPhotoType }[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = sniffImageType(bytes);
      if (!type)
        return { status: "error", fieldErrors: { photos: `${file.name} isn't a JPG, PNG or WebP photo.` } };
      photos.push({ bytes, type });
    }

    const supabase = await createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, reference, status, scheduled_start, business_id, reviews(id), businesses(owner_id)")
      .eq("id", bookingId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!booking) throw new AppError("NOT_FOUND", "Booking not found.");
    if (!canReview({ ...booking, hasReview: Boolean(booking.reviews) })) {
      throw new AppError("FORBIDDEN", "You can review a booking once it’s completed, and only once.");
    }

    // The database also checks the booking is completed and belongs to this customer.
    const { data: review, error } = await createAdminClient()
      .from("reviews")
      .insert({
        booking_id: booking.id,
        customer_id: customer.id,
        business_id: booking.business_id,
        rating: parsed.data.rating,
        comment: parsed.data.comment ?? null,
      })
      .select("id")
      .single();
    if (error || !review) {
      if (error.code === "23505") throw new AppError("CONFLICT", "You’ve already reviewed this booking.");
      if (error?.code === "23514") throw new AppError("FORBIDDEN", "This booking can’t be reviewed.");
      throw new AppError("INTERNAL", "Could not save your review.", { cause: error });
    }
    if (photos.length > 0) await saveReviewPhotos(review.id, photos);
    if (booking.businesses?.owner_id) {
      await notify({
        userId: booking.businesses.owner_id,
        type: "review.created",
        title: `New ${parsed.data.rating}-star review`,
        body: `A customer reviewed ${booking.reference}.`,
        data: { bookingId: booking.id },
      });
    }
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { status: "error", message: error.message };
    logger.error("Review failed", { error });
    return { status: "error", message: "We couldn't save your review. Please try again." };
  }
  redirect(`/account/bookings/${bookingId}?reviewed=1`);
}
