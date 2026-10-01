import { BusinessCard } from "@/components/marketplace/business-card";
import { Button, EmptyState, LinkButton } from "@/components/ui";
import { MatchReasons } from "@/components/marketplace/match-reasons";
import type { SearchResult } from "@/lib/marketplace/queries";
import { PAGE_SIZE } from "@/lib/marketplace/search-params";
import { explainMatch, type MatchNeeds } from "@/lib/matching/explain";

const needKinds = new Set(["location", "availability", "price", "guests"]);

/** Results with compare checkboxes and simple pagination links. */
export function ResultsList({
  results,
  page,
  pageHref,
  needs,
}: {
  results: SearchResult[];
  page: number;
  pageHref: (page: number) => string;
  /** What the customer filtered on; each result then says whether it fits. */
  needs?: MatchNeeds;
}) {
  const explain = Boolean(needs && (needs.location || needs.date || needs.guests || needs.budgetMinor));
  const hasMore = results.length > PAGE_SIZE;
  const visible = results.slice(0, PAGE_SIZE);

  if (visible.length === 0) {
    return (
      <EmptyState
        title="No verified businesses match yet"
        description="Try a nearby area, a higher budget, or describe what you need to the concierge."
        action={
          <LinkButton href="/concierge" variant="outline">
            Ask the concierge
          </LinkButton>
        }
      />
    );
  }

  return (
    <form action="/compare" className="flex flex-col gap-3">
      <ul className="grid gap-3 lg:grid-cols-2">
        {visible.map((business) => (
          <li key={business.id}>
            <BusinessCard
              business={business}
              action={
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    name="ids"
                    value={business.slug}
                    className="size-4 accent-foreground"
                  />
                  Compare
                </label>
              }
            >
              {business.matched_services && business.matched_services.length > 0 && (
                <p className="line-clamp-1 text-sm text-muted">{business.matched_services.join(" · ")}</p>
              )}
              {explain && needs && (
                <MatchReasons
                  reasons={explainMatch(business, needs).filter((reason) => needKinds.has(reason.kind))}
                />
              )}
            </BusinessCard>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {visible.length > 1 && (
          <Button type="submit" variant="outline">
            Compare selected
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {page > 1 && (
            <LinkButton href={pageHref(page - 1)} variant="ghost">
              Previous
            </LinkButton>
          )}
          {hasMore && (
            <LinkButton href={pageHref(page + 1)} variant="ghost">
              Next
            </LinkButton>
          )}
        </div>
      </div>
    </form>
  );
}
