"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { priceLabel } from "@/components/marketplace/service-list";
import { Badge, Button, Input, Select } from "@/components/ui";
import { deleteServiceAction, saveServiceAction } from "@/lib/business/actions";
import type { OwnService } from "@/lib/business/queries";
import type { ServiceKind } from "@/lib/business/schemas";
import { cn } from "@/lib/utils/cn";

import type { CategoryOption } from "./details-form";

const kindOptions: { value: ServiceKind; title: string; body: string }[] = [
  { value: "service", title: "Service", body: "A single service, e.g. a deep clean." },
  { value: "package", title: "Package", body: "A bundle with a list of what's included." },
  { value: "addon", title: "Add-on", body: "An optional extra booked with a service." },
];

const pricingOptions = [
  { value: "fixed", label: "Fixed price" },
  { value: "hourly", label: "Per hour" },
  { value: "starting_from", label: "Starting from" },
  { value: "quote_only", label: "Price on request (quote)" },
] as const;

function kindOf(service: OwnService): ServiceKind {
  return service.is_addon ? "addon" : service.is_package ? "package" : "service";
}

function ServiceForm({
  service,
  categories,
  onDone,
}: {
  service?: OwnService;
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveServiceAction, { status: "idle" });
  const value = (key: string, saved: string) => state.values?.[key] ?? saved;
  const [kind, setKind] = useState<ServiceKind>(
    (state.values?.kind as ServiceKind) ?? (service ? kindOf(service) : "service"),
  );
  const [pricing, setPricing] = useState(state.values?.pricingType ?? service?.pricing_type ?? "fixed");
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-2xl border border-foreground/20 bg-surface p-4"
      noValidate
    >
      {service && <input type="hidden" name="serviceId" value={service.id} />}
      <input type="hidden" name="kind" value={kind} />
      {state.message && state.status === "error" && <FormMessage tone="error">{state.message}</FormMessage>}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {kindOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={kind === option.value}
              onClick={() => {
                setKind(option.value);
                if (option.value === "addon" && (pricing === "quote_only" || pricing === "starting_from"))
                  setPricing("fixed");
              }}
              className={cn(
                "rounded-xl border p-3 text-left",
                kind === option.value ? "border-foreground" : "border-border",
              )}
            >
              <span className="block text-sm font-medium">{option.title}</span>
              <span className="block text-xs text-muted">{option.body}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <Input
        label="Name"
        name="name"
        defaultValue={value("name", service?.name ?? "")}
        required
        error={errors.name}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="service-description" className="text-sm font-medium">
          Description (optional)
        </label>
        <textarea
          id="service-description"
          name="description"
          rows={3}
          maxLength={3000}
          defaultValue={value("description", service?.description ?? "")}
          className="rounded-xl border border-border bg-surface p-3 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
        />
      </div>

      {kind === "package" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="service-includes" className="text-sm font-medium">
            What’s included (one per line)
          </label>
          <textarea
            id="service-includes"
            name="includes"
            rows={4}
            defaultValue={value("includes", service?.package_includes.join("\n") ?? "")}
            aria-invalid={errors.includes ? true : undefined}
            className="rounded-xl border border-border bg-surface p-3 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
          />
          {errors.includes && <p className="text-sm text-danger">{errors.includes}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Pricing"
          name="pricingType"
          value={pricing}
          onChange={(event) => setPricing(event.target.value as typeof pricing)}
        >
          {pricingOptions
            .filter((o) => kind !== "addon" || o.value === "fixed" || o.value === "hourly")
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </Select>
        {pricing !== "quote_only" && (
          <Input
            label={pricing === "hourly" ? "Price per hour (₦)" : "Price (₦)"}
            name="price"
            inputMode="decimal"
            placeholder="e.g. 150000"
            defaultValue={value(
              "price",
              service?.price_minor != null ? String(service.price_minor / 100) : "",
            )}
            error={errors.price ?? errors.pricingType}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Duration in minutes (optional)"
          name="durationMinutes"
          type="number"
          min={15}
          step={15}
          defaultValue={value(
            "durationMinutes",
            service?.duration_minutes ? String(service.duration_minutes) : "",
          )}
          error={errors.durationMinutes}
        />
        <Select
          label="Category (optional)"
          name="categoryId"
          defaultValue={value("categoryId", service?.category_id ?? "")}
        >
          <option value="">Same as my business</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.group === c.name ? c.name : `${c.group}: ${c.name}`}
            </option>
          ))}
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={state.values ? state.values.isActive === "on" : (service?.is_active ?? true)}
          className="size-4 accent-foreground"
        />
        Show this to customers
      </label>

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {service ? "Save service" : "Add service"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Services, packages and add-ons, with inline add and edit. */
export function ServicesManager({
  services,
  categories,
}: {
  services: OwnService[];
  categories: CategoryOption[];
}) {
  const [editing, setEditing] = useState<string | "new" | null>(services.length === 0 ? "new" : null);
  const close = () => setEditing(null);
  const main = services.filter((s) => !s.is_addon);
  const addons = services.filter((s) => s.is_addon);

  const renderList = (list: OwnService[]) => (
    <ul className="flex flex-col gap-3">
      {list.map((service) =>
        editing === service.id ? (
          <li key={service.id}>
            <ServiceForm service={service} categories={categories} onDone={close} />
          </li>
        ) : (
          <li
            key={service.id}
            className={cn(
              "flex items-start justify-between gap-3 rounded-2xl border border-border bg-surface p-4",
              !service.is_active && "opacity-70",
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{service.name}</h3>
                {service.is_package && <Badge tone="accent">Package</Badge>}
                {service.is_addon && <Badge>Add-on</Badge>}
                {!service.is_active && <Badge>Hidden</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted">{priceLabel(service)}</p>
              {service.package_includes.length > 0 && (
                <p className="mt-1 text-sm text-muted">Includes: {service.package_includes.join(", ")}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Edit ${service.name}`}
                onClick={() => setEditing(service.id)}
              >
                <Pencil aria-hidden className="size-4" />
              </Button>
              <form
                action={deleteServiceAction.bind(null, service.id)}
                onSubmit={(event) => {
                  if (!window.confirm(`Delete “${service.name}”? Past bookings keep their details.`))
                    event.preventDefault();
                }}
              >
                <Button type="submit" variant="ghost" size="sm" aria-label={`Delete ${service.name}`}>
                  <Trash2 aria-hidden className="size-4 text-danger" />
                </Button>
              </form>
            </div>
          </li>
        ),
      )}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="main-services">
        <h2 id="main-services" className="font-semibold">
          Services and packages
        </h2>
        {main.length > 0 ? renderList(main) : <p className="text-sm text-muted">No services yet.</p>}
      </section>
      {addons.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="addon-services">
          <h2 id="addon-services" className="font-semibold">
            Add-ons
          </h2>
          {renderList(addons)}
        </section>
      )}
      {editing === "new" ? (
        <ServiceForm categories={categories} onDone={close} />
      ) : (
        <Button type="button" variant="outline" className="self-start" onClick={() => setEditing("new")}>
          <Plus aria-hidden className="size-4" />
          Add a service, package or add-on
        </Button>
      )}
    </div>
  );
}
