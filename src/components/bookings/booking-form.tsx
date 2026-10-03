"use client";

import { startTransition, useEffect, useRef, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { priceLabel } from "@/components/marketplace/service-list";
import { Button, Input } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { bookingFeeFor, NO_BOOKING_FEE, type BookingFeeRule } from "@/lib/bookings/rules";
import { formatNaira } from "@/lib/format";
import type { BusinessService } from "@/lib/marketplace/queries";
import { cn } from "@/lib/utils/cn";
import { useFormAction } from "@/lib/utils/use-form-action";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

const textareaClass =
  "rounded-xl border border-border bg-surface p-3 text-base placeholder:text-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm";

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background">
          {step}
        </span>
        {title}
      </legend>
      {hint && <p className="-mt-1 mb-1 text-sm text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Choice({
  type,
  name,
  id,
  value,
  checked,
  disabled,
  onChange,
  title,
  detail,
  children,
}: {
  type: "checkbox" | "radio";
  name: string;
  id: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border bg-surface p-3",
        checked && "border-foreground",
        disabled && "opacity-60",
      )}
    >
      <input
        type={type}
        id={id}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 size-4 accent-foreground"
      />
      <label htmlFor={id} className="flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-muted">{detail}</span>
      </label>
      {children}
    </div>
  );
}

export function BookingForm({
  action,
  services,
  preselected,
  quoteMode,
  minDate,
  maxDate,
  defaults,
  serviceAreas,
  bookingFee = NO_BOOKING_FEE,
}: {
  action: Action;
  services: BusinessService[];
  preselected: string[];
  quoteMode: boolean;
  minDate: string;
  maxDate: string;
  defaults: { addressLine?: string; area?: string; city?: string; state?: string; date?: string };
  /** Where the business works, e.g. "Lekki, Lagos". */
  serviceAreas: string[];
  /** Shown so the customer sees the full price; the server works out the real amount. */
  bookingFee?: BookingFeeRule;
}) {
  const [state, formAction, pending] = useFormAction(action, { status: "idle" });
  // On phones a slim total-and-send bar follows the customer until the summary itself is on screen.
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  useEffect(() => {
    const node = summaryRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setSummaryVisible(Boolean(entry?.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const mainServices = services.filter((service) => !service.is_addon && !service.is_package);
  const packages = services.filter((service) => service.is_package && !service.is_addon);
  const addons = services.filter((service) => service.is_addon);

  const [selected, setSelected] = useState<Record<string, number>>(
    Object.fromEntries(preselected.filter((id) => !packages.some((p) => p.id === id)).map((id) => [id, 1])),
  );
  const [packageId, setPackageId] = useState<string>(
    preselected.find((id) => packages.some((p) => p.id === id)) ?? "",
  );
  const [mode, setMode] = useState<"book" | "quote">(quoteMode ? "quote" : "book");
  // One key per visit to the form: sending it twice can't make two bookings.
  const [requestKey] = useState(() => crypto.randomUUID());

  const chosenPackage = packages.find((p) => p.id === packageId);
  const hasMain = mainServices.some((service) => selected[service.id]) || Boolean(chosenPackage);
  // Add-ons only count alongside a service or package (or in a quote request).
  const chosen = [
    ...(chosenPackage ? [chosenPackage] : []),
    ...services.filter(
      (service) =>
        !service.is_package && selected[service.id] && (!service.is_addon || hasMain || mode === "quote"),
    ),
  ];
  const quantityOf = (id: string) => (id === packageId ? 1 : (selected[id] ?? 1));
  const needsQuote =
    mode === "quote" || chosen.some((s) => s.pricing_type !== "fixed" && s.pricing_type !== "hourly");
  const servicesTotal = chosen.reduce((sum, s) => sum + (s.price_minor ?? 0) * quantityOf(s.id), 0);
  const fee = bookingFeeFor(servicesTotal, bookingFee);
  const estimate = servicesTotal + fee;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });

  let step = 0;
  return (
    <form
      // Submitted by hand rather than with `action`, so a validation error doesn't clear what was entered.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-7"
      noValidate
    >
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="requestKey" value={requestKey} />
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

      {mainServices.length > 0 && (
        <Section
          step={++step}
          title="Service"
          hint={
            mode === "quote"
              ? "Optional. Pick what you’re interested in."
              : packages.length > 0
                ? "Pick one or more, or choose a package below."
                : "Pick one or more."
          }
        >
          {mainServices.map((service) => {
            const checked = Boolean(selected[service.id]);
            return (
              <Choice
                key={service.id}
                type="checkbox"
                name="serviceIds"
                id={`svc-${service.id}`}
                value={service.id}
                checked={checked}
                onChange={() => toggle(service.id)}
                title={service.name}
                detail={priceLabel(service)}
              >
                {checked && service.pricing_type === "hourly" && (
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
              </Choice>
            );
          })}
          {state.fieldErrors?.serviceIds && (
            <p className="text-sm text-danger">{state.fieldErrors.serviceIds}</p>
          )}
        </Section>
      )}

      {packages.length > 0 && (
        <Section step={++step} title="Package" hint="Bundles at a set price. Choose one, or none.">
          <Choice
            type="radio"
            name="packageId"
            id="pkg-none"
            value=""
            checked={packageId === ""}
            onChange={() => setPackageId("")}
            title="No package"
            detail="Just the services above"
          />
          {packages.map((pack) => (
            <Choice
              key={pack.id}
              type="radio"
              name="packageId"
              id={`pkg-${pack.id}`}
              value={pack.id}
              checked={packageId === pack.id}
              onChange={() => setPackageId(pack.id)}
              title={pack.name}
              detail={[
                priceLabel(pack),
                pack.package_includes?.length ? `Includes ${pack.package_includes.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
          {state.fieldErrors?.packageId && (
            <p className="text-sm text-danger">{state.fieldErrors.packageId}</p>
          )}
          {mainServices.length === 0 && state.fieldErrors?.serviceIds && (
            <p className="text-sm text-danger">{state.fieldErrors.serviceIds}</p>
          )}
        </Section>
      )}

      <Section step={++step} title="Date and time">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date"
            name="date"
            type="date"
            min={minDate}
            max={maxDate}
            defaultValue={defaults.date}
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
      </Section>

      <Section
        step={++step}
        title="Location"
        hint={serviceAreas.length > 0 ? `Works in ${serviceAreas.join(" · ")}` : undefined}
      >
        <Input
          label="Address"
          name="addressLine"
          autoComplete="street-address"
          defaultValue={defaults.addressLine}
          required
          error={state.fieldErrors?.addressLine}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Area"
            name="area"
            placeholder="e.g. Lekki"
            defaultValue={defaults.area}
            required
            error={state.fieldErrors?.area}
          />
          <Input
            label="City"
            name="city"
            autoComplete="address-level2"
            defaultValue={defaults.city ?? "Lagos"}
            required
            error={state.fieldErrors?.city}
          />
          <Input
            label="State"
            name="state"
            autoComplete="address-level1"
            defaultValue={defaults.state ?? "Lagos"}
            required
            error={state.fieldErrors?.state}
          />
        </div>
      </Section>

      {addons.length > 0 && (
        <Section
          step={++step}
          title="Add-ons"
          hint={hasMain || mode === "quote" ? "Optional extras." : "Choose a service or package first."}
        >
          {addons.map((addon) => (
            <Choice
              key={addon.id}
              type="checkbox"
              name="serviceIds"
              id={`svc-${addon.id}`}
              value={addon.id}
              checked={Boolean(selected[addon.id])}
              disabled={!hasMain && mode !== "quote"}
              onChange={() => toggle(addon.id)}
              title={addon.name}
              detail={`+ ${priceLabel(addon)}`}
            />
          ))}
        </Section>
      )}

      <Section step={++step} title="Additional requirements">
        <Input
          label="Number of guests (optional)"
          name="guests"
          type="number"
          inputMode="numeric"
          min={1}
          className="max-w-40"
          error={state.fieldErrors?.guests}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm font-medium">
            {mode === "quote"
              ? "Describe what you need"
              : "Anything else the business should know (optional)"}
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            maxLength={3000}
            placeholder={
              mode === "quote"
                ? "Theme, colours, timings, anything that affects the price."
                : "Theme, timings, gate code, parking, special requests."
            }
            aria-invalid={state.fieldErrors?.notes ? true : undefined}
            className={textareaClass}
          />
          {state.fieldErrors?.notes && <p className="text-sm text-danger">{state.fieldErrors.notes}</p>}
        </div>
      </Section>

      <div ref={summaryRef} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        {chosen.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {chosen.map((service) => (
              <li key={service.id} className="flex justify-between gap-3">
                <span>
                  {service.name}
                  {quantityOf(service.id) > 1 && (
                    <span className="text-muted"> × {quantityOf(service.id)}</span>
                  )}
                </span>
                <span className="text-muted">
                  {service.price_minor ? formatNaira(service.price_minor * quantityOf(service.id)) : "Quote"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {fee > 0 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Booking fee</span>
            <span>{formatNaira(fee)}</span>
          </div>
        )}
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

      {chosen.length > 0 && !summaryVisible && (
        <div
          className="fixed inset-x-0 bottom-(--bottom-nav) z-20 flex items-center gap-3 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden"
          data-testid="booking-bar"
        >
          <p className="flex flex-1 flex-col">
            <span className="text-xs text-muted">{needsQuote ? "Estimate" : "Total"}</span>
            <span className="font-semibold">{estimate > 0 ? formatNaira(estimate) : "Quote"}</span>
          </p>
          <Button type="submit" loading={pending}>
            Send request
          </Button>
        </div>
      )}
    </form>
  );
}
