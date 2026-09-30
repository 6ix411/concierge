import { MapPin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/ui";
import { formatNairaShort } from "@/lib/format";
import type { SearchResult } from "@/lib/marketplace/queries";

import { BusinessAvatar } from "./business-avatar";
import { Rating } from "./rating";
import { VerifiedBadge } from "./verified-badge";

export function BusinessCard({
  business,
  children,
  action,
}: {
  business: SearchResult;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const areas = business.served_areas?.slice(0, 3).join(", ");
  return (
    <Card className="relative flex flex-col gap-3 p-4">
      <div className="flex gap-3">
        <BusinessAvatar name={business.name} logoPath={business.logo_path} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/businesses/${business.slug}`}
              className="truncate font-semibold tracking-tight after:absolute after:inset-0 hover:underline"
            >
              {business.name}
            </Link>
            {business.is_verified && <VerifiedBadge />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <Rating value={Number(business.rating_avg)} count={business.rating_count} />
            {business.category_name && <span>{business.category_name}</span>}
          </div>
          {areas && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted">
              <MapPin aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{areas}</span>
            </p>
          )}
        </div>
        <div className="text-right">
          {business.min_price_minor !== null ? (
            <>
              <p className="text-xs text-muted">from</p>
              <p className="font-semibold">{formatNairaShort(business.min_price_minor)}</p>
            </>
          ) : (
            <p className="text-xs text-muted">Price on request</p>
          )}
        </div>
      </div>
      {children}
      {action && <div className="relative z-10 flex flex-wrap gap-2">{action}</div>}
    </Card>
  );
}
