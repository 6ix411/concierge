"use client";

import { Lock } from "lucide-react";
import { useActionState, useEffect } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { CheckoutState } from "@/lib/payments/actions";

export function CheckoutButton({
  action,
  label,
}: {
  action: (prev: CheckoutState) => Promise<CheckoutState>;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const leaving = Boolean(state.redirectTo);
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Button type="submit" size="lg" loading={pending || leaving}>
        <Lock aria-hidden className="size-4" />
        {label}
      </Button>
    </form>
  );
}
