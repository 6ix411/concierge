"use client";

import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { withdrawDisputeAction } from "@/lib/disputes/actions";
import { useFormAction } from "@/lib/utils/use-form-action";

/** Lets whoever opened a dispute take it back, after confirming. */
export function WithdrawDispute({ disputeId }: { disputeId: string }) {
  const [state, action, pending] = useFormAction(withdrawDisputeAction.bind(null, disputeId), {
    status: "idle",
  } as FormState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button type="button" variant="ghost" className="self-start" onClick={() => setConfirming(true)}>
        Withdraw the dispute
      </Button>
    );
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm">
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <p>
        Withdraw it if you&apos;ve sorted it out. The booking goes back to how it was. This can&apos;t be
        undone.
      </p>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          Yes, withdraw
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep it open
        </Button>
      </div>
    </form>
  );
}
