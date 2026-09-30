import { Check, Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { ConciergeBox } from "@/components/concierge/concierge-box";
import { Container } from "@/components/layout/container";
import { BusinessCard } from "@/components/marketplace/business-card";
import { Badge, Button, EmptyState, LinkButton } from "@/components/ui";
import { matchProviders } from "@/lib/concierge/match";
import { formatNairaShort } from "@/lib/format";

export const metadata: Metadata = { title: "Concierge" };

export default async function ConciergePage({ searchParams }: PageProps<"/concierge">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 500) : "";

  if (!query) {
    return (
      <Container className="flex max-w-2xl flex-col gap-6 py-10">
        <div className="flex flex-col gap-2">
          <Sparkles aria-hidden className="size-6 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What do you need done?</h1>
          <p className="text-muted">
            Include the service, the area, the date and your budget if you know them. We’ll match you with
            verified businesses on Concierge.
          </p>
        </div>
        <ConciergeBox autoFocus />
      </Container>
    );
  }

  const { intent, recommendations, relaxed } = await matchProviders(query);
  const understood = [
    intent.categoryLabel,
    intent.location,
    intent.guests ? `${intent.guests} guests` : null,
    intent.budgetMinor ? `Budget ${formatNairaShort(intent.budgetMinor)}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-6 sm:py-10">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-3 text-sm leading-relaxed text-brand-foreground">
          {query}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Sparkles aria-hidden className="size-4" />
          </span>
          <div className="flex flex-col gap-2 pt-1">
            {recommendations.length > 0 ? (
              <p className="leading-relaxed">
                {recommendations.length === 1
                  ? "I found one verified provider that fits."
                  : `I found ${recommendations.length} verified providers that fit.`}{" "}
                Compare them below, or refine your request.
              </p>
            ) : (
              <p className="leading-relaxed">
                I couldn’t find a verified provider for that yet. Try different words, a nearby area, or
                browse all services.
              </p>
            )}
            {understood.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">I understood:</span>
                {understood.map((item) => (
                  <Badge key={item}>{item}</Badge>
                ))}
              </div>
            )}
            {relaxed.map((note) => (
              <p key={note} className="text-sm text-muted">
                {note}
              </p>
            ))}
          </div>
        </div>

        {recommendations.length > 0 ? (
          <form action="/compare" className="flex flex-col gap-3">
            <ol className="flex flex-col gap-3">
              {recommendations.map((business) => (
                <li key={business.id}>
                  <BusinessCard
                    business={business}
                    action={
                      <>
                        <LinkButton href={`/businesses/${business.slug}`} variant="outline" size="sm">
                          View profile
                        </LinkButton>
                        <LinkButton href={`/book/${business.slug}`} size="sm">
                          Book
                        </LinkButton>
                        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted">
                          <input
                            type="checkbox"
                            name="ids"
                            value={business.slug}
                            className="size-4 accent-foreground"
                          />
                          Compare
                        </label>
                      </>
                    }
                  >
                    {business.reasons.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {business.reasons.map((reason) => (
                          <li key={reason} className="flex items-start gap-2 text-sm">
                            <Check
                              aria-hidden
                              className={
                                reason.includes("above your budget")
                                  ? "mt-0.5 size-4 shrink-0 text-muted"
                                  : "mt-0.5 size-4 shrink-0 text-verified"
                              }
                            />
                            {reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </BusinessCard>
                </li>
              ))}
            </ol>
            {recommendations.length > 1 && (
              <Button type="submit" variant="outline" className="self-start">
                Compare selected
              </Button>
            )}
          </form>
        ) : (
          <EmptyState
            title="No matches yet"
            description="New businesses are verified every week."
            action={
              <LinkButton href="/services" variant="outline">
                Browse all services
              </LinkButton>
            }
          />
        )}
      </div>

      <div className="sticky bottom-16 border-t border-border bg-background pt-4 pb-2 md:bottom-0">
        <ConciergeBox defaultValue={query} compact showExamples={false} />
      </div>
    </Container>
  );
}
