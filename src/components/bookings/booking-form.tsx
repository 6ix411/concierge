"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { priceLabel } from "@/components/marketplace/service-list";
import { Button, Input } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { formatNaira } from "@/lib/format";
import type { BusinessService } from "@/lib/marketplace/queries";
import { cn } from "@/lib/utils/cn";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function BookingForm({
  action,
  services,
  preselected,
  quoteMode,
  minDate,
  maxDate,
  defaults,
}: {
  action: Action;
  services: BusinessService[];
  preselected: string[];
  quoteMode: boolean;
  minDate: string;
  maxDate: string;
  defaults: { addressLine?: string; area?: string; state?: string };
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [selected, setSelected] = useState<Record<string, number>>(
    Object.fromEntries(preselected.map((id) => [id, 1])),
  );
  const [mode, setMode] = useState<"book" | "quote">(quoteMode ? "quote" : "book");

  const mainServices = services.filter((service) => !service.is_addon);
  const addons = services.filter((service) => service.is_addon);
  const hasMainService = mainServices.some((service) => selected[service.id]);
  // Add-ons only count alongside a main service (or in a quote request).
  const chosen = services.filter(
    (service) => selected[service.id] && (!service.is_addon || hasMainService || mode === "quote"),
  );
  const needsQuote =
    mode === "quote" || chosen.some((s) => s.pricing_type !== "fixed" && s.pricing_type !== "hourly");
  const estimate = chosen.reduce((sum, s) => sum + (s.price_minor ?? 0) * (selected[s.id] ?? 1), 0);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="mode" value={mode} />
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}

      <div
        className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1"
        role="radiogroup"
        aria-label="Request type"
      >
        {(
          [
            ["book", "Book a service"],
            ["quote", "Request a quote"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "h-10 rounded-lg text-sm font-medium transition",
              mode === value ? "bg-surface shadow-sm" : "text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          {mode === "quote" ? "Services you’re interested in (optional)" : "Choose services"}
        </legend>
        {mainServices.map((service) => {
          const checked = Boolean(selected[service.id]);
          const perUnit = service.pricing_type === "hourly";
          return (
            <div
              key={service.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border border-border bg-surface p-3",
                checked && "border-foreground",
              )}
            >
              <input
                type="checkbox"
                id={`svc-${service.id}`}
                name="serviceIds"
                value={service.id}
                checked={checked}
                onChange={() => toggle(service.id)}
                className="mt-1 size-4 accent-foreground"
              />
              <label htmlFor={`svc-${service.id}`} className="flex-1 cursor-pointer">
                <span className="block text-sm font-medium">{service.name}</span>
                <span className="block text-sm text-muted">{priceLabel(service)}</span>
              </label>
              {checked && perUnit && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Hours</span>
                  <input
                    type="number"
                    name={`quantity-${service.id}`}
                    min={1}
                    max={24}
                    value={selected[service.id]}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [service.id]: Math.max(1, Math.min(24, Number(event.target.value) || 1)),
                      }))
                    }
                    className="h-9 w-16 rounded-lg border border-border bg-surface px-2"
                  />
                </label>
              )}
            </div>
          );
        })}
        {state.fieldErrors?.serviceIds && (
          <p className="text-sm text-danger">{state.fieldErrors.serviceIds}</p>
        )}
      </fieldset>
      {addons.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Add-ons (optional)</legend>
          <p className="mb-1 text-sm text-muted">
            {hasMainService || mode === "quote"
              ? "Extras you can add to your booking."
              : "Choose a service first."}
          </p>
          {addons.map((addon) => (
            <div
              key={addon.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border border-border bg-surface p-3",
                selected[addon.id] && "border-foreground",
              )}
            >
              <input
                type="checkbox"
                id={`svc-${addon.id}`}
                name="serviceIds"
                value={addon.id}
                checked={Boolean(selected[addon.id])}
                disabled={!hasMainService && mode !== "quote"}
                onChange={() => toggle(addon.id)}
                className="mt-1 size-4 accent-foreground"
              />
              <label htmlFor={`svc-${addon.id}`} className="flex-1 cursor-pointer">
                <span className="block text-sm font-medium">{addon.name}</span>
                <span className="block text-sm text-muted">+ {priceLabel(addon)}</span>
              </label>
            </div>
          ))}
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Date"
          name="date"
          type="date"
          min={minDate}
          max={maxDate}
          required
          error={state.fieldErrors?.date}
        />
        <Input
          label="Start time"
          name="time"
          type="time"
          step={900}
          required
          error={state.fieldErrors?.time}
        />
      </div>

      <div className="flex flex-col gap-3">
        <Input
          label="Address"
          name="addressLine"
          autoComplete="street-address"
          defaultValue={defaults.addressLine}
          required
          error={state.fieldErrors?.addressLine}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Area"
            name="area"
            placeholder="e.g. Lekki"
            defaultValue={defaults.area}
            required
            error={state.fieldErrors?.area}
          />
          <Input
            label="State"
            name="state"
            defaultValue={defaults.state ?? "Lagos"}
            required
            error={state.fieldErrors?.state}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          {mode === "quote" ? "Describe what you need" : "Notes for the business (optional)"}
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={3000}
          placeholder={
            mode === "quote"
              ? "Guests, theme, colours, anything that affects the price."
              : "Gate code, parking, special requests."
          }
          aria-invalid={state.fieldErrors?.notes ? true : undefined}
          className="rounded-xl border border-border bg-surface p-3 text-base placeholder:text-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
        />
        {state.fieldErrors?.notes && <p className="text-sm text-danger">{state.fieldErrors.notes}</p>}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{needsQuote ? "Estimate" : "Total"}</span>
          <span className="text-lg font-semibold">{estimate > 0 ? formatNaira(estimate) : "—"}</span>
        </div>
        <p className="text-sm text-muted">
          {needsQuote
            ? "The business will confirm a final price. You only pay after you accept it."
            : "You won’t be charged yet. You pay once the business accepts your booking."}
        </p>
        <Button type="submit" size="lg" loading={pending}>
          {needsQuote ? "Send quote request" : "Send booking request"}
        </Button>
      </div>
    </form>
  );
}
