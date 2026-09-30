"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button, Input } from "@/components/ui";
import { signUpAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils/cn";
import type { SelfServiceRole } from "@/types/roles";

import { FormMessage } from "./form-message";

const initialState: FormState = { status: "idle" };

const roleOptions: { value: SelfServiceRole; title: string; body: string }[] = [
  { value: "customer", title: "I need a service", body: "Find and book verified businesses." },
  { value: "business", title: "I run a business", body: "Get verified and receive bookings." },
];

export function SignUpForm({ defaultRole = "customer" }: { defaultRole?: SelfServiceRole }) {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const [role, setRole] = useState<SelfServiceRole>(
    (state.values?.role as SelfServiceRole | undefined) ?? defaultRole,
  );

  if (state.status === "success") {
    return <FormMessage tone="success">{state.message}</FormMessage>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.message && <FormMessage tone="error">{state.message}</FormMessage>}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Account type</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roleOptions.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-xl border border-border bg-surface p-3 transition",
                "has-focus-visible:ring-2 has-focus-visible:ring-focus",
                role === option.value && "border-foreground",
              )}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{option.title}</span>
              <span className="text-sm text-muted">{option.body}</span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.role && <p className="text-sm text-danger">{state.fieldErrors.role}</p>}
      </fieldset>

      <Input
        label={role === "business" ? "Your full name (account owner)" : "Full name"}
        name="fullName"
        autoComplete="name"
        required
        defaultValue={state.values?.fullName}
        error={state.fieldErrors?.fullName}
      />
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
        autoComplete="new-password"
        required
        hint="At least 8 characters, with a letter and a number."
        error={state.fieldErrors?.password}
      />
      <Button type="submit" size="lg" loading={pending}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
