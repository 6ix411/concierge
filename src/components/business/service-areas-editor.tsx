"use client";

import { MapPin, X } from "lucide-react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input, Select } from "@/components/ui";
import { addServiceAreaAction, removeServiceAreaAction } from "@/lib/business/actions";
import { nigerianStates } from "@/lib/business/locations";
import { useFormAction } from "@/lib/utils/use-form-action";

type Area = { id: string; state: string; city: string | null; area: string | null };

/** Where the business works. The concierge only matches customers in these areas. */
export function ServiceAreasEditor({ areas, defaultState }: { areas: Area[]; defaultState?: string | null }) {
  const [state, formAction, pending] = useFormAction(addServiceAreaAction, { status: "idle" });

  return (
    <div className="flex flex-col gap-4">
      {areas.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Your service areas">
          {areas.map((area) => {
            const label = area.area ? `${area.area}, ${area.state}` : `All of ${area.state}`;
            return (
              <li
                key={area.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-3 text-sm"
              >
                <MapPin aria-hidden className="size-3.5 text-muted" />
                {label}
                <form action={removeServiceAreaAction.bind(null, area.id)}>
                  <button
                    type="submit"
                    aria-label={`Remove ${label}`}
                    className="-my-1 rounded-full p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No areas yet. Add at least one.</p>
      )}

      <form
        action={formAction}
        className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
      >
        {state.message && (
          <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Select label="State" name="state" defaultValue={defaultState ?? "Lagos"}>
            {nigerianStates.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Input
            label="Area (optional)"
            name="area"
            placeholder="e.g. Lekki, Ikeja"
            hint="Leave empty to cover the whole state."
            error={state.fieldErrors?.area}
          />
          <Button type="submit" variant="outline" loading={pending} className="sm:mb-6">
            Add area
          </Button>
        </div>
      </form>
    </div>
  );
}
