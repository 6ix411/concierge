"use client";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { useFormAction } from "@/lib/utils/use-form-action";

/** A percentage field. With `optional`, leaving it empty clears a business's custom rate. */
export function CommissionForm({
  action,
  businessId,
  defaultValue,
  optional = false,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  businessId?: string;
  defaultValue: string;
  optional?: boolean;
}) {
  const [state, formAction, pending] = useFormAction(action, { status: "idle" });
  const id = businessId ? `commission-${businessId}` : "commission";
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {businessId && <input type="hidden" name="businessId" value={businessId} />}
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <label htmlFor={id} className="text-sm font-medium">
        {optional ? "Custom commission (%)" : "Commission (%)"}
      </label>
      <div className="flex gap-2">
        <div className="relative w-32">
          <input
            id={id}
            name="percent"
            inputMode="decimal"
            defaultValue={defaultValue}
            placeholder={optional ? "Default" : "10"}
            aria-invalid={state.fieldErrors?.percent ? true : undefined}
            aria-describedby={state.fieldErrors?.percent ? `${id}-error` : `${id}-hint`}
            className="h-11 w-full rounded-xl border border-border bg-surface pr-8 pl-3 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
          />
          <span aria-hidden className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">
            %
          </span>
        </div>
        <Button type="submit" variant="outline" loading={pending}>
          Save
        </Button>
      </div>
      {state.fieldErrors?.percent ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {state.fieldErrors.percent}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {optional ? "Leave empty to use the platform rate." : "Between 0 and 50. Up to two decimals."}
        </p>
      )}
    </form>
  );
}
