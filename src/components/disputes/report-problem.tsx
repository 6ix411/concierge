"use client";

import { AlertTriangle } from "lucide-react";
import { startTransition, useActionState, useState } from "react";

import { textareaClass } from "@/components/admin/action-form";
import { FormMessage } from "@/components/auth/form-message";
import { Button, Input, Select } from "@/components/ui";
import { disputeReasons } from "@/lib/admin/rules";
import { openDisputeAction } from "@/lib/disputes/actions";

import { EvidencePicker } from "./evidence-picker";

/** Lets the customer or the business open a dispute on a paid booking, with evidence. */
export function ReportProblemForm({ bookingId, otherParty }: { bookingId: string; otherParty: string }) {
  const [state, formAction, pending] = useActionState(openDisputeAction, { status: "idle" });
  const [open, setOpen] = useState(false);
  // Kept in state; the form is submitted by hand so an error doesn't clear what was typed or picked.
  const [draft, setDraft] = useState({ reasonCode: "", reason: "", description: "" });
  const field = (name: keyof typeof draft) => ({
    name,
    value: draft[name],
    onChange: (event: { target: { value: string } }) => setDraft({ ...draft, [name]: event.target.value }),
  });
  if (state.status === "success") return <FormMessage tone="success">{state.message}</FormMessage>;
  if (!open) {
    return (
      <Button type="button" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        <AlertTriangle aria-hidden className="size-4" />
        Open a dispute
      </Button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <div>
        <h2 className="font-semibold">Open a dispute</h2>
        <p className="mt-1 text-sm text-muted">
          Try messaging {otherParty} first. If you can’t sort it out, the Concierge team will look into it and
          hold the payment until it’s settled. Once sent, what you report can’t be changed, but you can add to
          it.
        </p>
      </div>
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Select
        label="What's the problem?"
        name="reasonCode"
        defaultValue=""
        error={state.fieldErrors?.reasonCode}
      >
        <option value="" disabled>
          Choose one
        </option>
        {Object.entries(disputeReasons).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Input
        label="Summary"
        {...field("reason")}
        maxLength={200}
        required
        placeholder="e.g. The job wasn’t finished"
        error={state.fieldErrors?.reason}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`dispute-${bookingId}`} className="text-sm font-medium">
          What happened?
        </label>
        <textarea
          id={`dispute-${bookingId}`}
          {...field("description")}
          rows={5}
          maxLength={5000}
          required
          className={textareaClass}
        />
        {state.fieldErrors?.description && (
          <p className="text-sm text-danger">{state.fieldErrors.description}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">
          Evidence <span className="font-normal text-muted">(optional)</span>
        </p>
        <p className="text-sm text-muted">
          Photos, videos or PDFs such as receipts. Up to 5 files, 20 MB in all.
        </p>
        <EvidencePicker id={`dispute-files-${bookingId}`} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Open dispute
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
