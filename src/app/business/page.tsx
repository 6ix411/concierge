import { AlertCircle, CalendarClock, Check, Inbox, Star, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FormMessage } from "@/components/auth/form-message";
import { BusinessBookingList } from "@/components/business/business-booking-list";
import { StatusCard } from "@/components/business/status-card";
import { SubmitForReview } from "@/components/business/submit-for-review";
import { EmptyState, LinkButton } from "@/components/ui";
import { getBusinessAnalytics } from "@/lib/analytics/queries";
import { rate } from "@/lib/analytics/rules";
import { listBusinessBookings } from "@/lib/business/booking-queries";
import { monthlyEarnings } from "@/lib/business/earnings";
import { onboardingSteps } from "@/lib/business/onboarding";
import { getOnboardingProgress, getStatusNote, requireOwnBusiness } from "@/lib/business/queries";
import { canSubmitForReview } from "@/lib/business/status";
import { formatNaira } from "@/lib/format";
import { doneStatuses } from "@/lib/bookings/rules";
import { periodStart } from "@/lib/revenue/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Business dashboard" };

function Stat({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 transition hover:border-foreground/30"
    >
      <Icon aria-hidden className="size-5 text-muted" />
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </Link>
  );
}

export default async function BusinessOverviewPage({ searchParams }: PageProps<"/business">) {
  const { business } = await requireOwnBusiness();
  const { submitted } = await searchParams;
  const supabase = await createClient();

  const inSetup = canSubmitForReview(business.status);
  const approved = business.status === "approved";
  const [progress, note, requests, upcoming, paid, openRequests, insights] = await Promise.all([
    inSetup ? getOnboardingProgress(business) : null,
    getStatusNote(business.id),
    listBusinessBookings(business.id, "requests", 5),
    listBusinessBookings(business.id, "upcoming", 5),
    supabase
      .from("bookings")
      .select("status, subtotal_minor, commission_rate_bps, completed_at")
      .eq("business_id", business.id)
      .in("status", doneStatuses),
    supabase
      .from("verification_requests")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("status", "open"),
    approved ? getBusinessAnalytics(business.id, periodStart(30)) : null,
  ]);
  const thisMonth = monthlyEarnings(paid.data ?? [], 1)[0]?.netMinor ?? 0;
  const setupDone = progress ? onboardingSteps.every((step) => progress[step.key]) : true;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{business.name}</h1>
        <p className="mt-1 text-muted">Business dashboard</p>
      </div>

      {submitted === "1" && (
        <FormMessage tone="success">Submitted. We’ll review your business and let you know.</FormMessage>
      )}

      <StatusCard
        status={business.status}
        note={note}
        action={
          approved ? (
            <LinkButton href={`/businesses/${business.slug}`} variant="outline" size="sm">
              View public profile
            </LinkButton>
          ) : undefined
        }
      />

      {(openRequests.count ?? 0) > 0 && (
        <Link
          href="/business/verification"
          className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0 text-accent" />
          <span className="flex-1">
            The Concierge team has asked for more verification information.{" "}
            <span className="font-medium underline">Respond now</span>
          </span>
        </Link>
      )}

      {progress && (
        <section
          aria-labelledby="setup-heading"
          className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 sm:p-6"
        >
          <div>
            <h2 id="setup-heading" className="text-lg font-semibold">
              {business.status === "rejected" ? "Update and resubmit" : "Finish your registration"}
            </h2>
            <p className="text-sm text-muted">Complete every step, then submit your business for review.</p>
          </div>
          <ol className="flex flex-col divide-y divide-border">
            {onboardingSteps.map((step) => (
              <li key={step.key}>
                <Link
                  href={`/business/setup?step=${step.key}`}
                  className="flex items-center gap-3 py-3 hover:underline"
                >
                  <span
                    className={
                      progress[step.key]
                        ? "flex size-6 items-center justify-center rounded-full bg-verified text-white"
                        : "flex size-6 items-center justify-center rounded-full border border-border"
                    }
                  >
                    {progress[step.key] && <Check aria-hidden className="size-3.5" />}
                    <span className="sr-only">{progress[step.key] ? "Done:" : "To do:"}</span>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{step.title}</span>
                    <span className="block text-xs text-muted">{step.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {setupDone ? (
            <SubmitForReview resubmit={business.status === "rejected"} />
          ) : (
            <LinkButton href="/business/setup" className="self-start">
              Continue registration
            </LinkButton>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Inbox}
          label="Requests to answer"
          value={String(requests.length)}
          href="/business/bookings"
        />
        <Stat
          icon={CalendarClock}
          label="Upcoming bookings"
          value={String(upcoming.length)}
          href="/business/bookings?tab=upcoming"
        />
        <Stat
          icon={Wallet}
          label="Earned this month"
          value={formatNaira(thisMonth)}
          href="/business/earnings"
        />
        <Stat
          icon={Star}
          label={`${business.rating_count} review${business.rating_count === 1 ? "" : "s"}`}
          value={business.rating_count > 0 ? Number(business.rating_avg).toFixed(1) : "–"}
          href="/business/reviews"
        />
      </div>

      {insights && (
        <section
          aria-labelledby="insights-heading"
          className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
        >
          <div>
            <h2 id="insights-heading" className="font-semibold">
              Last 30 days
            </h2>
            <p className="text-sm text-muted">How customers found you on Concierge.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" data-testid="business-insights">
            {[
              { label: "Shown in searches", value: insights.search_appearances },
              { label: "Profile views", value: insights.profile_views },
              { label: "Booking requests", value: insights.booking_requests },
              { label: "Completed bookings", value: insights.completed_bookings },
            ].map((item) => (
              <div key={item.label} className="flex flex-col">
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
          {insights.profile_views > 0 && (
            <p className="text-sm text-muted">
              {rate(insights.booking_requests, insights.profile_views)} of profile views became a booking
              request.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 id="requests-heading" className="text-lg font-semibold">
            New requests
          </h2>
          <Link href="/business/bookings" className="text-sm font-medium text-muted hover:underline">
            All bookings
          </Link>
        </div>
        {requests.length > 0 ? (
          <BusinessBookingList bookings={requests} />
        ) : (
          <EmptyState
            title="No new requests"
            description={
              business.status === "approved"
                ? "Booking and quote requests from customers will show up here."
                : "Once you’re approved, customers can find and book you."
            }
          />
        )}
      </section>

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
          <h2 id="upcoming-heading" className="text-lg font-semibold">
            Coming up
          </h2>
          <BusinessBookingList bookings={upcoming} />
        </section>
      )}
    </div>
  );
}
