"use client";

import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { acceptQuoteAction, cancelBookingAction, rescheduleBookingAction } from "@/lib/bookings/actions";
import { useFormAction } from "@/lib/utils/use-form-action";

const idle: FormState = { status: "idle" };

export function AcceptQuoteForm({ bookingId, label }: { bookingId: string; label: string }) {
  const [state, action, pending] = useFormAction(acceptQuoteAction, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Button type="submit" size="lg" loading={pending}>
        {label}
      </Button>
    </form>
  );
}

export function RescheduleForm({
  bookingId,
  minDate,
  maxDate,
  defaultDate,
  defaultTime,
}: {
  bookingId: string;
  minDate: string;
  maxDate: string;
  defaultDate?: string;
  defaultTime?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(rescheduleBookingAction, idle);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Change date or time
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="New date"
          name="date"
          type="date"
          min={minDate}
          max={maxDate}
          defaultValue={defaultDate}
          error={state.fieldErrors?.date}
        />
        <Input
          label="New time"
          name="time"
          type="time"
          step={900}
          defaultValue={defaultTime}
          error={state.fieldErrors?.time}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Save new time
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function CancelBookingForm({ bookingId, afterPayment }: { bookingId: string; afterPayment: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(cancelBookingAction, idle);

  if (state.status === "success") return <FormMessage tone="success">{state.message}</FormMessage>;
  if (!open) {
    return (
      <Button variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-danger/40 p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-sm">
        {afterPayment
          ? "You’ve paid for this booking. You can cancel up to 24 hours before the start, and our team will handle your refund."
          : "The business will be told you cancelled. You haven’t been charged."}
      </p>
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reason" className="text-sm font-medium">
          Reason (optional)
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          maxLength={500}
          className="rounded-xl border border-border bg-surface p-3 text-base sm:text-sm"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={pending}>
          Yes, cancel
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Keep booking
        </Button>
      </div>
    </form>
  );
}
