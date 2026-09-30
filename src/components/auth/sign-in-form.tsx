"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button, Input } from "@/components/ui";
import { signInAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/schemas";

import { FormMessage } from "./form-message";

const initialState: FormState = { status: "idle" };

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {notice && state.status === "idle" && <FormMessage tone="error">{notice}</FormMessage>}
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <Button type="submit" size="lg" loading={pending}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}
