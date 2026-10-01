import { CalendarCheck, MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card, LinkButton } from "@/components/ui";
import { formatPriceRange } from "@/lib/format";
import type { SearchResult } from "@/lib/marketplace/queries";

import { BusinessAvatar } from "./business-avatar";
import { Rating } from "./rating";
import { VerifiedBadge } from "./verified-badge";

export function completedLabel(count: number): string {
  if (count === 0) return "No completed bookings yet";
  return `${count.toLocaleString("en-NG")} completed booking${count === 1 ? "" : "s"}`;
}

/**
 * A registered business in results: name, verification, rating, price range, areas and completed
 * bookings, then View profile, Compare and Book. Every value comes from the database row.
 */
export function BusinessCard({
  business,
  children,
  compare = true,
}: {
  business: SearchResult;
  children?: ReactNode;
  /** Show the Compare tick box (the list must sit inside a form that posts to /compare). */
  compare?: boolean;
}) {
  const areas = business.served_areas?.slice(0, 3).join(", ");
  const price = formatPriceRange(business.min_price_minor, business.max_price_minor);
  return (
    <Card className="relative flex flex-col gap-3 p-4">
      <div className="flex gap-3">
        <BusinessAvatar name={business.name} logoPath={business.logo_path} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/businesses/${business.slug}`}
              className="truncate font-semibold tracking-tight after:absolute after:inset-0 hover:underline"
            >
              {business.name}
            </Link>
            {business.is_verified && <VerifiedBadge />}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <Rating value={Number(business.rating_avg)} count={business.rating_count} />
            {business.category_name && <span>{business.category_name}</span>}
          </div>
          <p className="font-semibold tabular-nums">
            {price ?? (business.has_quote_only ? "Price on request" : "Prices not listed")}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {areas && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{areas}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <CalendarCheck aria-hidden className="size-3.5 shrink-0" />
              {completedLabel(business.completed_bookings)}
            </span>
          </div>
        </div>
      </div>
      {children}
      <div className="relative z-10 flex flex-wrap items-center gap-2">
        <LinkButton href={`/businesses/${business.slug}`} variant="outline" size="sm">
          View profile
        </LinkButton>
        {compare && (
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-sm">
            <input type="checkbox" name="ids" value={business.slug} className="size-4 accent-foreground" />
            Compare
          </label>
        )}
        <LinkButton href={`/book/${business.slug}`} size="sm" className="ml-auto">
          Book
        </LinkButton>
      </div>
    </Card>
  );
}
