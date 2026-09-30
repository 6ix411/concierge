"use client";

import { Lock } from "lucide-react";
import { useActionState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";

export function CheckoutButton({
  action,
  label,
}: {
  action: (prev: FormState) => Promise<FormState>;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Button type="submit" size="lg" loading={pending}>
        <Lock aria-hidden className="size-4" />
        {label}
      </Button>
    </form>
  );
}
