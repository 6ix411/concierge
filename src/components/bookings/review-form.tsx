"use client";

import { Star } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { submitReviewAction } from "@/lib/reviews/actions";
import { cn } from "@/lib/utils/cn";

const labels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(submitReviewAction, { status: "idle" } as FormState);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || rating;

  return (
    <form action={action} className="flex flex-col gap-5">
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
      <Button type="submit" size="lg" loading={pending} disabled={rating === 0}>
        Post review
      </Button>
    </form>
  );
}
