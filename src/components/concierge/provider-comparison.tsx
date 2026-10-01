import Link from "next/link";

import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { VerifiedBadge } from "@/components/marketplace/verified-badge";
import { LinkButton } from "@/components/ui";
import type { Recommendation } from "@/lib/concierge/types";
import { formatNairaShort } from "@/lib/format";

const locationText: Record<string, string> = {
  area: "Serves your area",
  city: "Covers your city",
  state: "Covers your state",
  nearby: "Nearby, not your area",
};

const rows: { label: string; render: (b: Recommendation) => string }[] = [
  {
    label: "From",
    render: (b) =>
      b.min_price_minor !== null
        ? `${formatNairaShort(b.min_price_minor)}${b.within_budget === false ? " (over budget)" : ""}`
        : "Price on request",
  },
  { label: "Matching service", render: (b) => b.matched_services?.[0] ?? "—" },
  {
    label: "Availability",
    render: (b) =>
      b.availability === "available"
        ? "Available"
        : b.availability === "unavailable"
          ? (b.availability_note ?? "Not available")
          : "No date given",
  },
  {
    label: "Area",
    render: (b) =>
      b.location_match
        ? locationText[b.location_match]!
        : (b.served_areas ?? []).slice(0, 3).join(", ") || "—",
  },
  {
    label: "Group size",
    render: (b) =>
      b.guest_capacity
        ? `Up to ${b.guest_capacity}${b.fits_guests === false ? " (too small)" : ""}`
        : "Not listed",
  },
  {
    label: "Rating",
    render: (b) =>
      b.rating_count > 0
        ? `${Number(b.rating_avg).toFixed(1)} (${b.rating_count} review${b.rating_count === 1 ? "" : "s"})`
        : "No reviews yet",
  },
  { label: "Completed bookings", render: (b) => String(b.completed_bookings) },
];

/** Providers side by side. Every value comes from the providers' Concierge listings. */
export function ProviderComparison({ providers }: { providers: Recommendation[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[520px] border-separate border-spacing-0 rounded-xl text-left text-sm">
        <caption className="sr-only">Providers compared side by side</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 w-32 bg-background" />
            {providers.map((b) => (
              <th key={b.id} scope="col" className="border-b border-border p-3 align-top font-normal">
                <div className="flex flex-col gap-2">
                  <BusinessAvatar name={b.name} logoPath={b.logo_path} size="sm" />
                  <Link href={`/businesses/${b.slug}`} className="font-semibold hover:underline">
                    {b.name}
                  </Link>
                  {b.is_verified && <VerifiedBadge />}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="sticky left-0 border-b border-border bg-background p-3 align-top font-medium text-muted"
              >
                {row.label}
              </th>
              {providers.map((b) => (
                <td key={b.id} className="border-b border-border p-3 align-top">
                  {row.render(b)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="sticky left-0 bg-background" />
            {providers.map((b) => (
              <td key={b.id} className="p-3">
                <LinkButton href={`/book/${b.slug}`} size="sm">
                  Book
                </LinkButton>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
