"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input, Select } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import type { Bank } from "@/lib/payments/types";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type SavedPayoutAccount = {
  bank_name: string;
  account_name: string;
  account_number: string;
  verified_at: string;
};

/** Where the business is paid. The bank confirms the account name before it's saved. */
export function PayoutAccountForm({
  action,
  banks,
  saved,
}: {
  action: Action;
  banks: Bank[];
  saved: SavedPayoutAccount | null;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  // The form is open from "Change" until the next successful save.
  const [editFrom, setEditFrom] = useState<FormState | null>(null);
  const errors = state.fieldErrors ?? {};
  const showForm = !saved || (editFrom !== null && !(state.status === "success" && state !== editFrom));

  if (saved && !showForm) {
    return (
      <div className="flex flex-col gap-3">
        {state.status === "success" && state.message && (
          <FormMessage tone="success">{state.message}</FormMessage>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted p-3 text-sm">
          <span>
            <span className="block font-medium">{saved.account_name}</span>
            <span className="text-muted">
              {saved.bank_name} · ••••••{saved.account_number.slice(-4)}
            </span>
          </span>
          <Button type="button" variant="outline" onClick={() => setEditFrom(state)}>
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      noValidate
      key={JSON.stringify(state.values ?? {})}
    >
      {state !== editFrom && state.status === "error" && state.message && (
        <FormMessage tone="error">{state.message}</FormMessage>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Bank"
          name="bankCode"
          defaultValue={state.values?.bankCode ?? ""}
          required
          error={errors.bankCode}
        >
          <option value="" disabled>
            Choose your bank
          </option>
          {banks.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </Select>
        <Input
          label="Account number"
          name="accountNumber"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          placeholder="0123456789"
          defaultValue={state.values?.accountNumber ?? ""}
          required
          error={errors.accountNumber}
        />
      </div>
      <p className="text-sm text-muted">
        We check the account with your bank and show the name it&apos;s registered to. It should be your
        business account.
      </p>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Verify and save
        </Button>
        {saved && (
          <Button type="button" variant="ghost" onClick={() => setEditFrom(null)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
