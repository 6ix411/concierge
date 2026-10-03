"use client";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input, Select } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { nigerianStates } from "@/lib/business/locations";
import { MIN_DESCRIPTION_LENGTH } from "@/lib/business/onboarding";
import { useFormAction } from "@/lib/utils/use-form-action";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type CategoryOption = { id: string; name: string; group: string };

export type BusinessDetailsDefaults = {
  name?: string | null;
  description?: string | null;
  primary_category_id?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
};

/** Business information: name, description, category, contact details and location. */
export function DetailsForm({
  action,
  categories,
  defaults = {},
  submitLabel = "Save changes",
  next,
}: {
  action: Action;
  categories: CategoryOption[];
  defaults?: BusinessDetailsDefaults;
  submitLabel?: string;
  next?: string;
}) {
  const [state, formAction, pending] = useFormAction(action, { status: "idle" });
  const errors = state.fieldErrors ?? {};
  // After a failed save, keep what was typed rather than the saved values.
  const value = (key: string, saved?: string | null) => state.values?.[key] ?? saved ?? "";
  const groups = [...new Set(categories.map((c) => c.group))];

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-semibold">About your business</legend>
        <Input
          label="Business name"
          name="name"
          defaultValue={value("name", defaults.name)}
          required
          error={errors.name}
        />
        <Select
          label="Main category"
          name="categoryId"
          defaultValue={value("categoryId", defaults.primary_category_id)}
          required
          aria-invalid={errors.categoryId ? true : undefined}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {categories
                .filter((c) => c.group === group)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        {errors.categoryId && <p className="-mt-2 text-sm text-danger">{errors.categoryId}</p>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={5}
            maxLength={5000}
            defaultValue={value("description", defaults.description)}
            placeholder="What you do, who you work with and what makes you different."
            aria-invalid={errors.description ? true : undefined}
            aria-describedby="description-hint"
            className="rounded-xl border border-border bg-surface p-3 text-base placeholder:text-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
          />
          {errors.description ? (
            <p className="text-sm text-danger">{errors.description}</p>
          ) : (
            <p id="description-hint" className="text-sm text-muted">
              At least {MIN_DESCRIPTION_LENGTH} characters. Customers and the concierge read this.
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-semibold">Contact information</legend>
        <p className="-mt-1 text-sm text-muted">
          For the platform team. Customers contact you through Concierge chat once a booking is confirmed.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="0803 123 4567"
            defaultValue={value("phone", defaults.phone)}
            error={errors.phone}
          />
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={value("email", defaults.email)}
            error={errors.email}
          />
        </div>
        <Input
          label="Website or Instagram (optional)"
          name="website"
          type="url"
          placeholder="https://"
          defaultValue={value("website", defaults.website)}
          error={errors.website}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-semibold">Location</legend>
        <Input
          label="Address (optional)"
          name="addressLine"
          autoComplete="street-address"
          defaultValue={value("addressLine", defaults.address_line)}
          error={errors.addressLine}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="City or area"
            name="city"
            placeholder="e.g. Lekki"
            defaultValue={value("city", defaults.city)}
            required
            error={errors.city}
          />
          <Select
            label="State"
            name="state"
            defaultValue={value("state", defaults.state ?? "Lagos")}
            required
          >
            {nigerianStates.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        {errors.state && <p className="-mt-2 text-sm text-danger">{errors.state}</p>}
      </fieldset>

      <Button type="submit" size="lg" loading={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
