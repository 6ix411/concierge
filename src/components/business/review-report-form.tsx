"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import { reportReviewAction } from "@/lib/business/review-actions";

/** Flags a review for the Concierge team to check. The business can't remove reviews itself. */
export function ReviewReportForm({ reviewId }: { reviewId: string }) {
  const [state, formAction, pending] = useActionState(reportReviewAction, { status: "idle" });
  const [open, setOpen] = useState(false);
  if (state.status === "success" && state.message)
    return <FormMessage tone="success">{state.message}</FormMessage>;
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Report to Concierge
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <label htmlFor={`report-${reviewId}`} className="text-sm font-medium">
        Which guideline does this review break?
      </label>
      <textarea
        id={`report-${reviewId}`}
        name="reason"
        rows={3}
        maxLength={1000}
        className="rounded-xl border border-border bg-surface p-3 text-base sm:text-sm"
      />
      {state.fieldErrors?.reason && <p className="text-sm text-danger">{state.fieldErrors.reason}</p>}
      <p className="text-xs text-muted">
        The review stays up while the Concierge team checks it against the guidelines.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" loading={pending}>
          Send report
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
