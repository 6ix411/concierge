"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import { replyToReviewAction } from "@/lib/business/review-actions";

/** A public reply under a customer's review. */
export function ReviewReplyForm({ reviewId, existing }: { reviewId: string; existing: string | null }) {
  const [state, formAction, pending] = useActionState(replyToReviewAction, { status: "idle" });
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        {existing ? "Edit reply" : "Reply"}
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <label htmlFor={`reply-${reviewId}`} className="text-sm font-medium">
        Your public reply
      </label>
      <textarea
        id={`reply-${reviewId}`}
        name="reply"
        rows={3}
        maxLength={2000}
        defaultValue={existing ?? ""}
        className="rounded-xl border border-border bg-surface p-3 text-base sm:text-sm"
      />
      {state.fieldErrors?.reply && <p className="text-sm text-danger">{state.fieldErrors.reply}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Post reply
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
