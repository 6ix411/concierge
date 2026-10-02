"use client";

import { useActionState, type ReactNode } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

const naira = (minor: number | null) => (minor === null ? "" : String(minor / 100));
const percent = (bps: number | null) => (bps === null ? "" : String(bps / 100));

function SettingsForm({
  action,
  children,
  label,
  saveLabel = "Save",
}: {
  action: Action;
  children: (state: FormState) => ReactNode;
  label: string;
  saveLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} aria-label={label} className="flex flex-col gap-3">
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      {children(state)}
      <div>
        <Button type="submit" variant="outline" loading={pending}>
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}

function ActiveToggle({ defaultChecked, disabled }: { defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="active"
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="size-4 accent-foreground"
      />
      Offered to businesses
      {/* A disabled box isn't submitted; Free is always offered. */}
      {disabled && <input type="hidden" name="active" value="on" />}
    </label>
  );
}

export type PlanRow = {
  code: string;
  name: string;
  description: string | null;
  monthly_price_minor: number;
  commission_rate_bps: number | null;
  perks: string[];
  is_active: boolean;
};

export function PlanForm({ action, plan }: { action: Action; plan: PlanRow }) {
  const free = plan.code === "free";
  return (
    <SettingsForm action={action} label={`${plan.name} plan`}>
      {(state) => (
        <>
          <input type="hidden" name="code" value={plan.code} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Name" name="name" defaultValue={plan.name} error={state.fieldErrors?.name} />
            <Input
              label="Monthly price (₦)"
              name="price"
              inputMode="decimal"
              defaultValue={naira(plan.monthly_price_minor)}
              readOnly={free}
              hint={free ? "Free is always ₦0." : undefined}
              error={state.fieldErrors?.price}
            />
            <Input
              label="Commission (%)"
              name="commission"
              inputMode="decimal"
              defaultValue={percent(plan.commission_rate_bps)}
              placeholder="Platform rate"
              hint="Leave empty to use the platform rate."
              error={state.fieldErrors?.commission}
            />
          </div>
          <Input
            label="Short description"
            name="description"
            defaultValue={plan.description ?? ""}
            error={state.fieldErrors?.description}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`perks-${plan.code}`} className="text-sm font-medium">
              What’s included (one per line)
            </label>
            <textarea
              id={`perks-${plan.code}`}
              name="perks"
              rows={3}
              defaultValue={plan.perks.join("\n")}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
            />
            {state.fieldErrors?.perks && <p className="text-sm text-danger">{state.fieldErrors.perks}</p>}
          </div>
          <ActiveToggle defaultChecked={plan.is_active} disabled={free} />
        </>
      )}
    </SettingsForm>
  );
}

export function FeaturedPackageForm({
  action,
  pkg,
}: {
  action: Action;
  pkg: { code: string; name: string; duration_days: number; price_minor: number; is_active: boolean };
}) {
  return (
    <SettingsForm action={action} label={`${pkg.name} featured placement`}>
      {(state) => (
        <>
          <input type="hidden" name="code" value={pkg.code} />
          <Input
            label={`${pkg.name} (${pkg.duration_days} days), price (₦)`}
            name="price"
            inputMode="decimal"
            defaultValue={naira(pkg.price_minor)}
            error={state.fieldErrors?.price}
          />
          <ActiveToggle defaultChecked={pkg.is_active} />
        </>
      )}
    </SettingsForm>
  );
}

export function FeaturedSlotsForm({ action, slots }: { action: Action; slots: number }) {
  return (
    <SettingsForm action={action} label="Featured slots">
      {(state) => (
        <Input
          label="Featured providers at the top of results"
          name="slots"
          inputMode="numeric"
          defaultValue={String(slots)}
          hint="0 to 10. Only providers that meet every requirement of the search can take a slot."
          error={state.fieldErrors?.slots}
        />
      )}
    </SettingsForm>
  );
}

export function BookingFeeForm({
  action,
  fee,
}: {
  action: Action;
  fee: { percentBps: number; flatMinor: number; capMinor: number | null };
}) {
  return (
    <SettingsForm action={action} label="Customer booking fee">
      {(state) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Percentage (%)"
            name="percent"
            inputMode="decimal"
            defaultValue={fee.percentBps ? percent(fee.percentBps) : ""}
            placeholder="0"
            hint="Of the service price, up to 20%."
            error={state.fieldErrors?.percent}
          />
          <Input
            label="Fixed amount (₦)"
            name="flat"
            inputMode="decimal"
            defaultValue={fee.flatMinor ? naira(fee.flatMinor) : ""}
            placeholder="0"
            error={state.fieldErrors?.flat}
          />
          <Input
            label="Most a fee can be (₦)"
            name="cap"
            inputMode="decimal"
            defaultValue={naira(fee.capMinor)}
            placeholder="No cap"
            error={state.fieldErrors?.cap}
          />
        </div>
      )}
    </SettingsForm>
  );
}
