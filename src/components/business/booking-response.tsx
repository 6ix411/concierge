"use client";

import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { sendQuoteAction, updateBookingStatusAction } from "@/lib/business/booking-actions";
import type { BusinessBookingAction } from "@/lib/business/booking-rules";
import { useFormAction } from "@/lib/utils/use-form-action";

type StatusAction = Exclude<BusinessBookingAction, "quote">;

function Feedback({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>;
}

function StatusButton({
  bookingId,
  action,
  label,
  variant = "primary",
}: {
  bookingId: string;
  action: StatusAction;
  label: string;
  variant?: "primary" | "outline";
}) {
  const [state, formAction, pending] = useFormAction(updateBookingStatusAction.bind(null, action), {
    status: "idle",
  });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state.status === "error" && <Feedback state={state} />}
      <Button type="submit" variant={variant} loading={pending}>
        {label}
      </Button>
    </form>
  );
}

function ReasonForm({
  bookingId,
  action,
  label,
  prompt,
  onCancel,
}: {
  bookingId: string;
  action: "decline" | "cancel";
  label: string;
  prompt: string;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useFormAction(updateBookingStatusAction.bind(null, action), {
    status: "idle",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Feedback state={state} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${action}-reason`} className="text-sm font-medium">
          {prompt}
        </label>
        <textarea
          id={`${action}-reason`}
          name="reason"
          rows={3}
          maxLength={500}
          required
          className="rounded-xl border border-border bg-surface p-3 text-base sm:text-sm"
        />
        {state.fieldErrors?.reason && <p className="text-sm text-danger">{state.fieldErrors.reason}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={pending}>
          {label}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </form>
  );
}

function QuoteForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useFormAction(sendQuoteAction, { status: "idle" });
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
      noValidate
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <h3 className="font-semibold">Send a quote</h3>
      <Feedback state={state} />
      <Input
        label="Total price (₦)"
        name="amount"
        inputMode="decimal"
        placeholder="e.g. 850000"
        error={state.fieldErrors?.amount}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="quote-notes" className="text-sm font-medium">
          What the price covers (optional)
        </label>
        <textarea
          id="quote-notes"
          name="notes"
          rows={3}
          maxLength={3000}
          className="rounded-xl border border-border bg-surface p-3 text-base sm:text-sm"
        />
      </div>
      <p className="text-sm text-muted">
        The customer accepts and pays on Concierge before the job is confirmed.
      </p>
      <Button type="submit" loading={pending} className="self-start">
        Send quote
      </Button>
    </form>
  );
}

/** The next steps the business can take on a booking. */
export function BookingResponse({
  bookingId,
  actions,
}: {
  bookingId: string;
  actions: BusinessBookingAction[];
}) {
  const [reason, setReason] = useState<"decline" | "cancel" | null>(null);
  if (actions.length === 0) return null;

  if (reason) {
    return (
      <ReasonForm
        bookingId={bookingId}
        action={reason}
        label={reason === "decline" ? "Decline booking" : "Cancel booking"}
        prompt={reason === "decline" ? "Why can’t you take this booking?" : "Why are you cancelling?"}
        onCancel={() => setReason(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {actions.includes("quote") && <QuoteForm bookingId={bookingId} />}
      <div className="flex flex-wrap gap-2">
        {actions.includes("accept") && (
          <StatusButton bookingId={bookingId} action="accept" label="Accept booking" />
        )}
        {actions.includes("start") && (
          <StatusButton bookingId={bookingId} action="start" label="Mark as started" variant="outline" />
        )}
        {actions.includes("complete") && (
          <StatusButton bookingId={bookingId} action="complete" label="Mark as completed" />
        )}
        {actions.includes("decline") && (
          <Button type="button" variant="ghost" className="text-danger" onClick={() => setReason("decline")}>
            Decline
          </Button>
        )}
        {actions.includes("cancel") && (
          <Button type="button" variant="ghost" className="text-danger" onClick={() => setReason("cancel")}>
            Cancel booking
          </Button>
        )}
      </div>
    </div>
  );
}
