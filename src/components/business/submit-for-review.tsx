"use client";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import { submitForReviewAction } from "@/lib/business/actions";
import { useFormAction } from "@/lib/utils/use-form-action";

export function SubmitForReview({
  resubmit = false,
  disabled = false,
}: {
  resubmit?: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useFormAction(submitForReviewAction, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Button
        type="submit"
        size="lg"
        variant="accent"
        loading={pending}
        disabled={disabled}
        className="self-start"
      >
        {resubmit ? "Resubmit for review" : "Submit for review"}
      </Button>
    </form>
  );
}
