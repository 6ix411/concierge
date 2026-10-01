import { CalendarCheck, Sparkles } from "lucide-react";

import { BusinessCard } from "@/components/marketplace/business-card";
import { MatchReasons } from "@/components/marketplace/match-reasons";
import { Button, LinkButton } from "@/components/ui";
import type { ConciergeReply, Recommendation } from "@/lib/concierge/types";
import { formatRequestDate, isFullMatch } from "@/lib/matching/explain";

import { ProviderComparison } from "./provider-comparison";

export function AssistantAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
      <Sparkles aria-hidden className="size-4" />
    </span>
  );
}

export function AssistantReply({
  reply,
  showUnderstood,
  suggestions,
  onSuggestion,
}: {
  reply: ConciergeReply;
  showUnderstood: boolean;
  suggestions: string[];
  onSuggestion?: (text: string) => void;
}) {
  const comparing = reply.compare && reply.providers.length >= 2;
  const fits = reply.providers.filter(isFullMatch);
  const close = reply.providers.filter((provider) => !isFullMatch(provider));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <AssistantAvatar />
        <div className="flex min-w-0 flex-col gap-3 pt-1">
          <p className="leading-relaxed whitespace-pre-line">{reply.message}</p>
          {showUnderstood && reply.understood.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
              <p className="text-xs font-medium text-muted">Here’s what I understood</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {reply.understood.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-muted">{row.label}</dt>
                    <dd className="font-medium">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      {comparing && <ProviderComparison providers={reply.providers} />}

      {!comparing && reply.providers.length > 0 && (
        <form action="/compare" className="flex flex-col gap-3">
          {fits.length > 0 && <ProviderCards providers={fits} />}
          {close.length > 0 && (
            <>
              {fits.length > 0 && (
                <h3 className="mt-2 text-sm font-semibold">
                  Close options
                  <span className="font-normal text-muted"> · each misses something you asked for</span>
                </h3>
              )}
              <ProviderCards providers={close} />
            </>
          )}
          {reply.providers.length > 1 && (
            <Button type="submit" variant="outline" className="self-start">
              Compare selected
            </Button>
          )}
        </form>
      )}

      {reply.booking && (
        <div className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4 sm:flex-row sm:items-center">
          <CalendarCheck aria-hidden className="size-6 shrink-0 text-accent" />
          <div className="flex-1">
            <p className="font-semibold">Book {reply.booking.businessName}</p>
            <p className="text-sm text-muted">
              {[
                reply.booking.services.join(", "),
                reply.booking.date ? formatRequestDate(reply.booking.date) : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Choose the service and time on the next page."}
            </p>
            <p className="mt-1 text-xs text-muted">
              Nothing is booked yet. You’ll confirm the details and pay on the next page.
            </p>
          </div>
          <LinkButton href={reply.booking.href} className="self-start sm:self-center">
            Start booking
          </LinkButton>
        </div>
      )}

      {suggestions.length > 0 && onSuggestion && (
        <div className="flex flex-wrap gap-2 pl-11">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestion(suggestion)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCards({ providers }: { providers: Recommendation[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {providers.map((business) => (
        <li key={business.id}>
          <BusinessCard business={business}>
            <MatchReasons reasons={business.reasons} />
          </BusinessCard>
        </li>
      ))}
    </ol>
  );
}
