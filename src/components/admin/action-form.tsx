"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, type ButtonProps } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export const textareaClass =
  "rounded-xl border border-border bg-surface p-3 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm";

/**
 * A one-button admin action. With `reason`, the button first opens a short form asking why
 * (the reason goes to the audit log, and to the affected user when `reason.hint` says so).
 */
export function AdminActionForm({
  action,
  fields,
  label,
  variant = "outline",
  reason,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  variant?: ButtonProps["variant"];
  reason?: { label: string; required?: boolean; placeholder?: string; name?: string };
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [open, setOpen] = useState(false);
  const reasonName = reason?.name ?? "reason";
  const id = `${label}-${Object.values(fields).join("-")}`.replace(/\W+/g, "-");

  if (state.status === "success" && state.message) {
    return <FormMessage tone="success">{state.message}</FormMessage>;
  }
  if (reason && !open) {
    return (
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={formAction} className={reason ? "flex w-full flex-col gap-2" : "flex flex-col gap-2"}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {reason && (
        <>
          <label htmlFor={id} className="text-sm font-medium">
            {reason.label}
            {!reason.required && <span className="font-normal text-muted"> (optional)</span>}
          </label>
          <textarea
            id={id}
            name={reasonName}
            rows={3}
            maxLength={2000}
            placeholder={reason.placeholder}
            className={textareaClass}
          />
          {state.fieldErrors?.[reasonName] && (
            <p className="text-sm text-danger">{state.fieldErrors[reasonName]}</p>
          )}
        </>
      )}
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <div className="flex gap-2">
        <Button type="submit" variant={variant} loading={pending}>
          {label}
        </Button>
        {reason && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
