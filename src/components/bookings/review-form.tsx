"use client";

import { ImagePlus, Star, X } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { submitReviewAction } from "@/lib/reviews/actions";
import {
  MAX_REVIEW_PHOTOS,
  REVIEW_PHOTO_TYPES,
  reviewGuidelines,
  reviewPhotosProblem,
} from "@/lib/reviews/rules";
import { cn } from "@/lib/utils/cn";

const labels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(submitReviewAction, { status: "idle" } as FormState);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // The file input is the source of truth for the form; keep it in step with the chosen photos.
  useEffect(() => {
    if (!input.current) return;
    const transfer = new DataTransfer();
    for (const photo of photos) transfer.items.add(photo);
    input.current.files = transfer.files;
  }, [photos]);
  const previews = useMemo(() => photos.map((photo) => URL.createObjectURL(photo)), [photos]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function addPhotos(list: FileList | null) {
    const next = [...photos, ...Array.from(list ?? [])];
    const problem = reviewPhotosProblem(next);
    setPhotoError(problem);
    if (!problem) setPhotos(next);
    else if (input.current) {
      // Put back what was there before the rejected pick.
      const transfer = new DataTransfer();
      for (const photo of photos) transfer.items.add(photo);
      input.current.files = transfer.files;
    }
  }

  return (
    <form action={action} className="flex flex-col gap-5" encType="multipart/form-data">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="rating" value={rating} />
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Your rating</legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} star${value === 1 ? "" : "s"}: ${labels[value]}`}
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
              onMouseEnter={() => setHover(value)}
              className="rounded-lg p-1"
            >
              <Star
                aria-hidden
                className={cn("size-8", value <= shown ? "fill-accent text-accent" : "text-border")}
              />
            </button>
          ))}
          <span className="ml-2 text-sm text-muted">{labels[shown]}</span>
        </div>
        {state.fieldErrors?.rating && <p className="mt-1 text-sm text-danger">{state.fieldErrors.rating}</p>}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="comment" className="text-sm font-medium">
          Tell others about your experience (optional)
        </label>
        <textarea
          id="comment"
          name="comment"
          rows={5}
          maxLength={2000}
          className="rounded-xl border border-border bg-surface p-3 text-base sm:text-sm"
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Photos (optional)</legend>
        <p className="text-sm text-muted">
          Up to {MAX_REVIEW_PHOTOS} photos of the job, JPG, PNG or WebP, 5 MB each.
        </p>
        <div className="flex flex-wrap gap-2">
          {previews.map((url, index) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Photo ${index + 1}`}
                className="size-20 rounded-xl border border-border object-cover"
              />
              <button
                type="button"
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => {
                  setPhotoError(null);
                  setPhotos(photos.filter((_, i) => i !== index));
                }}
                className="absolute -top-2 -right-2 rounded-full border border-border bg-surface p-1 shadow-sm"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          ))}
          {photos.length < MAX_REVIEW_PHOTOS && (
            <label
              htmlFor="review-photos"
              className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted hover:bg-surface-muted"
            >
              <ImagePlus aria-hidden className="size-5" />
              Add photo
            </label>
          )}
        </div>
        <input
          ref={input}
          id="review-photos"
          name="photos"
          type="file"
          multiple
          accept={REVIEW_PHOTO_TYPES.join(",")}
          className="sr-only"
          onChange={(event) => addPhotos(event.target.files)}
        />
        {(photoError ?? state.fieldErrors?.photos) && (
          <p className="text-sm text-danger">{photoError ?? state.fieldErrors?.photos}</p>
        )}
      </fieldset>
      <details className="rounded-xl bg-surface-muted p-3 text-sm">
        <summary className="cursor-pointer py-2 font-medium">Review guidelines</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          {reviewGuidelines.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="mt-2 text-muted">
          Reviews that break these are hidden by the Concierge team. You can review each booking once.
        </p>
      </details>
      <Button type="submit" size="lg" loading={pending} disabled={rating === 0}>
        Post review
      </Button>
    </form>
  );
}
