"use client";

import Link from "next/link";

import { Button, Input } from "@/components/ui";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/schemas";

import { FormMessage } from "./form-message";
import { useFormAction } from "@/lib/utils/use-form-action";

const initialState: FormState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useFormAction(requestPasswordResetAction, initialState);
  if (state.status === "success")
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="success">{state.message}</FormMessage>
        <Link href="/sign-in" className="text-center text-sm font-medium underline underline-offset-4">
          Back to sign in
        </Link>
      </div>
    );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Button type="submit" size="lg" loading={pending}>
        Send reset link
      </Button>
      <p className="text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
