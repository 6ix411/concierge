"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Select } from "@/components/ui";
import { reportAction } from "@/lib/chat/actions";
import { reportReasons } from "@/lib/chat/rules";

/** Reports a message, or the other person when there's no message, to the Concierge team. */
export function ReportForm({
  conversationId,
  messageId,
  title,
  onClose,
}: {
  conversationId: string;
  messageId?: string;
  title: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(reportAction, { status: "idle" });
  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
        <FormMessage tone="success">{state.message}</FormMessage>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3 text-sm"
    >
      <p className="font-medium">{title}</p>
      <input type="hidden" name="conversationId" value={conversationId} />
      {messageId && <input type="hidden" name="messageId" value={messageId} />}
      <Select label="Reason" name="reason" defaultValue="" required>
        <option value="" disabled>
          Choose a reason
        </option>
        {Object.entries(reportReasons).map(([key, reason]) => (
          <option key={key} value={key}>
            {reason.label}
          </option>
        ))}
      </Select>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">
          What happened? <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          name="details"
          rows={3}
          maxLength={1000}
          className="rounded-xl border border-border bg-surface p-3 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
        />
      </label>
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={pending}>
          Send report
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
