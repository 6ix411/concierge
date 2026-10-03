"use client";

import { Lock } from "lucide-react";
import { useEffect } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { CheckoutState } from "@/lib/payments/actions";
import { useFormAction } from "@/lib/utils/use-form-action";

export function CheckoutButton({
  action,
  label,
  size = "lg",
  variant = "primary",
}: {
  action: (prev: CheckoutState) => Promise<CheckoutState>;
  label: string;
  size?: "md" | "lg";
  variant?: "primary" | "outline";
}) {
  const [state, formAction, pending] = useFormAction(action, { status: "idle" });
  const leaving = Boolean(state.redirectTo);
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Button type="submit" size={size} variant={variant} loading={pending || leaving}>
        <Lock aria-hidden className="size-4" />
        {label}
      </Button>
    </form>
  );
}
