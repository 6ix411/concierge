"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input } from "@/components/ui";
import { changePasswordAction, updateProfileAction } from "@/lib/account/actions";
import type { FormState } from "@/lib/auth/schemas";

const idle: FormState = { status: "idle" };

export function ProfileForm({
  defaults,
  showAddress,
}: {
  defaults: { fullName: string; phone: string; addressLine: string; city: string; state: string };
  showAddress: boolean;
}) {
  const [state, action, pending] = useActionState(updateProfileAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <Input
        label="Full name"
        name="fullName"
        autoComplete="name"
        defaultValue={defaults.fullName}
        error={state.fieldErrors?.fullName}
      />
      <Input
        label="Phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder="+234…"
        defaultValue={defaults.phone}
        error={state.fieldErrors?.phone}
      />
      {showAddress && (
        <>
          <Input
            label="Default address"
            name="addressLine"
            autoComplete="street-address"
            defaultValue={defaults.addressLine}
            hint="Used to pre-fill your bookings."
            error={state.fieldErrors?.addressLine}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Area" name="city" defaultValue={defaults.city} error={state.fieldErrors?.city} />
            <Input
              label="State"
              name="state"
              defaultValue={defaults.state}
              error={state.fieldErrors?.state}
            />
          </div>
        </>
      )}
      <Button type="submit" loading={pending} className="self-start">
        Save changes
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <Input
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        error={state.fieldErrors?.currentPassword}
      />
      <Input
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number."
        error={state.fieldErrors?.newPassword}
      />
      <Button type="submit" variant="outline" loading={pending} className="self-start">
        Change password
      </Button>
    </form>
  );
}
