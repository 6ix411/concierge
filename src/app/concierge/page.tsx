import { Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { ConciergeBox } from "@/components/concierge/concierge-box";
import { Container } from "@/components/layout/container";
import { BusinessCard } from "@/components/marketplace/business-card";
import { MatchReasons } from "@/components/marketplace/match-reasons";
import { Button, EmptyState, LinkButton } from "@/components/ui";
import { matchProviders, type Recommendation } from "@/lib/concierge/match";
import { describeRequest } from "@/lib/matching/explain";

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

  const { request, recommendations, alternatives, notes } = await matchProviders(query);
  const understood = describeRequest(request);
  const found = recommendations.length;

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
            <p className="leading-relaxed">
              {found > 0
                ? `${found === 1 ? "I found one verified provider" : `I found ${found} verified providers`} that fit${alternatives.length > 0 ? ", plus a few close options" : ""}. Compare them below, or refine your request.`
                : alternatives.length > 0
                  ? "Nobody fits every detail yet, but these verified providers come close."
                  : "I couldn’t find a verified provider for that yet. Try different words, a nearby area, or browse all services."}
            </p>
            {understood.length > 0 && (
              <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
                <p className="text-xs font-medium text-muted">Here’s what I understood</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {understood.map((row) => (
                    <div key={row.label} className="contents">
                      <dt className="text-muted">{row.label}</dt>
                      <dd className="font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {notes.map((note) => (
              <p key={note} className="text-sm text-muted">
                {note}
              </p>
            ))}
          </div>
        </div>

        {found + alternatives.length > 0 ? (
          <form action="/compare" className="flex flex-col gap-3">
            {found > 0 && <MatchList items={recommendations} />}
            {alternatives.length > 0 && (
              <>
                <h2 className="mt-2 text-sm font-semibold">
                  {found > 0 ? "Close options" : "Closest options"}
                  <span className="font-normal text-muted"> · each misses something you asked for</span>
                </h2>
                <MatchList items={alternatives} />
              </>
            )}
            {found + alternatives.length > 1 && (
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

function MatchList({ items }: { items: Recommendation[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((business) => (
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
            <MatchReasons reasons={business.reasons} />
          </BusinessCard>
        </li>
      ))}
    </ol>
  );
}
