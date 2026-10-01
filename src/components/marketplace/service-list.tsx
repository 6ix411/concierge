import { Check, Clock } from "lucide-react";

import { Badge, LinkButton } from "@/components/ui";
import { formatNaira } from "@/lib/format";
import type { BusinessService } from "@/lib/marketplace/queries";

export function priceLabel(service: Pick<BusinessService, "pricing_type" | "price_minor">): string {
  if (service.pricing_type === "quote_only" || service.price_minor === null) return "Price on request";
  const price = formatNaira(service.price_minor);
  if (service.pricing_type === "hourly") return `${price} / hour`;
  if (service.pricing_type === "starting_from") return `From ${price}`;
  return price;
}

function duration(minutes: number | null) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr${hours === 1 ? "" : "s"}`;
}

export function ServiceList({
  services,
  bookHref,
  bookable = true,
}: {
  services: BusinessService[];
  bookHref: (id: string) => string;
  bookable?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {services.map((service) => (
        <li key={service.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{service.name}</h3>
                {service.is_package && <Badge tone="accent">Package</Badge>}
              </div>
              {service.description && <p className="mt-1 text-sm text-muted">{service.description}</p>}
            </div>
            <p className="shrink-0 text-right font-semibold">{priceLabel(service)}</p>
          </div>
          {service.package_includes.length > 0 && (
            <ul className="grid gap-1 sm:grid-cols-2">
              {service.package_includes.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
                  {item}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2">
            {duration(service.duration_minutes) ? (
              <span className="inline-flex items-center gap-1 text-sm text-muted">
                <Clock aria-hidden className="size-4" />
                {duration(service.duration_minutes)}
              </span>
            ) : (
              <span />
            )}
            {bookable && (
              <LinkButton
                href={bookHref(service.id)}
                size="sm"
                variant={service.pricing_type === "quote_only" ? "outline" : "primary"}
              >
                {service.pricing_type === "quote_only" ? "Request quote" : "Book"}
              </LinkButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Optional extras, added on the booking form together with a main service. */
export function AddonList({ addons }: { addons: BusinessService[] }) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {addons.map((addon) => (
        <li key={addon.id} className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{addon.name}</p>
            {addon.description && <p className="mt-0.5 text-sm text-muted">{addon.description}</p>}
          </div>
          <p className="shrink-0 text-sm font-semibold">+ {priceLabel(addon)}</p>
        </li>
      ))}
    </ul>
  );
}
