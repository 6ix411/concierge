"use client";

import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { resetPasswordAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/schemas";

import { FormMessage } from "./form-message";

const initialState: FormState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters, with a letter and a number."
        error={state.fieldErrors?.password}
      />
      <Input
        label="Repeat new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirm}
      />
      <Button type="submit" size="lg" loading={pending}>
        Save new password
      </Button>
    </form>
  );
}
