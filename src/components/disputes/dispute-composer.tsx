"use client";

import { startTransition, useActionState, useState } from "react";

import { textareaClass } from "@/components/admin/action-form";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";

import { EvidencePicker } from "./evidence-picker";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Adds a message and/or evidence to a dispute. The admin version can write internal notes. */
export function DisputeComposer({
  disputeId,
  action,
  admin = false,
}: {
  disputeId: string;
  action: Action;
  admin?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as FormState);
  // The text and files survive an error; a successful send clears them.
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [sent, setSent] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "success") {
      setBody("");
      setInternal(false);
      setSent(sent + 1);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="disputeId" value={disputeId} />
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`dispute-body-${disputeId}`} className="text-sm font-medium">
          {admin ? "Message" : "Add to the dispute"}
        </label>
        <textarea
          id={`dispute-body-${disputeId}`}
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={5000}
          className={textareaClass}
          placeholder={admin ? undefined : "Anything the Concierge team should know"}
        />
        {state.fieldErrors?.body && <p className="text-sm text-danger">{state.fieldErrors.body}</p>}
      </div>
      <EvidencePicker id={`dispute-files-${disputeId}`} resetKey={sent} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending}>
          Send
        </Button>
        {admin && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="internal"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
              className="size-4"
            />
            Internal note (admins only)
          </label>
        )}
      </div>
    </form>
  );
}
