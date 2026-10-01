"use client";

import { AlertTriangle } from "lucide-react";
import { useActionState, useState } from "react";

import { textareaClass } from "@/components/admin/action-form";
import { FormMessage } from "@/components/auth/form-message";
import { Button, Input } from "@/components/ui";
import { openDisputeAction } from "@/lib/disputes/actions";

/** Lets the customer or the business report a problem with a paid booking to the Concierge team. */
export function ReportProblemForm({ bookingId, otherParty }: { bookingId: string; otherParty: string }) {
  const [state, formAction, pending] = useActionState(openDisputeAction, { status: "idle" });
  const [open, setOpen] = useState(false);
  if (state.status === "success") return <FormMessage tone="success">{state.message}</FormMessage>;
  if (!open) {
    return (
      <Button type="button" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        <AlertTriangle aria-hidden className="size-4" />
        Report a problem
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <div>
        <h2 className="font-semibold">Report a problem</h2>
        <p className="mt-1 text-sm text-muted">
          Try messaging {otherParty} first. If you can’t sort it out, our team will look into it and hold the
          payment until it’s settled.
        </p>
      </div>
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Input
        label="What went wrong?"
        name="reason"
        maxLength={200}
        required
        placeholder="e.g. The job wasn’t finished"
        error={state.fieldErrors?.reason}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`dispute-${bookingId}`} className="text-sm font-medium">
          Details <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={`dispute-${bookingId}`}
          name="description"
          rows={4}
          maxLength={5000}
          className={textareaClass}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Send to Concierge
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
