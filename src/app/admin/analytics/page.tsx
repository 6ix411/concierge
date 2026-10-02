import type { Metadata } from "next";
import Link from "next/link";

import {
  BarList,
  FilterTabs,
  PageHeader,
  Panel,
  StatCard,
  StatGroup,
} from "@/components/admin/dashboard-widgets";
import { getPlatformAnalytics } from "@/lib/analytics/queries";
import { ANALYTICS_PERIODS, bucketDaily, parsePeriod, rate } from "@/lib/analytics/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { formatNaira } from "@/lib/format";
import { periodStart } from "@/lib/revenue/queries";

export const metadata: Metadata = { title: "Analytics" };

const number = new Intl.NumberFormat("en-NG");
const n = (value: number) => number.format(value);

export default async function AdminAnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  await requireAreaAccess("admin");
  const period = parsePeriod((await searchParams).period);
  const a = await getPlatformAnalytics(periodStart(ANALYTICS_PERIODS[period].days));
  const trend = bucketDaily(a.daily);
  const trendMax = Math.max(1, ...trend.map((point) => Math.max(point.searches, point.booking_requests)));
  const platformRevenue = a.commission_minor + a.booking_fees_minor + a.business_charges_minor;

  const funnel = [
    {
      label: "Searches that found a provider",
      value: rate(a.searches_with_results, a.searches),
      detail: `${n(a.searches_with_results)} of ${n(a.searches)} searches`,
    },
    {
      label: "Profile views to booking requests",
      value: rate(a.booking_requests, a.profile_views),
      detail: `${n(a.booking_requests)} requests from ${n(a.profile_views)} views`,
    },
    {
      label: "Concierge chats that led to a booking",
      value: rate(a.ai_conversations_booked, a.ai_conversations),
      detail: `${n(a.ai_conversations_booked)} of ${n(a.ai_conversations)} chats, within 7 days`,
    },
    {
      label: "Requests that were confirmed",
      value: rate(a.requests_confirmed, a.booking_requests),
      detail: `${n(a.requests_confirmed)} of ${n(a.booking_requests)} requested in this period`,
    },
    {
      label: "Requests that were completed",
      value: rate(a.requests_completed, a.booking_requests),
      detail: `${n(a.requests_completed)} so far`,
    },
    {
      label: "Requests that were cancelled",
      value: rate(a.requests_cancelled, a.booking_requests),
      detail: `${n(a.requests_cancelled)} cancelled · ${n(a.declined)} declined by the provider`,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Analytics" description="How people find, book and pay for providers on Concierge." />
      <FilterTabs
        label="Period"
        current={period}
        tabs={Object.entries(ANALYTICS_PERIODS).map(([key, value]) => ({
          key,
          label: value.label,
          href: adminHref(`/analytics?period=${key}`),
        }))}
      />

      <StatGroup title="Sign-ups">
        <StatCard
          label="Customer registrations"
          value={n(a.customer_registrations)}
          href={adminHref("/users?role=customer")}
        />
        <StatCard
          label="Business registrations"
          value={n(a.business_registrations)}
          hint="Submitted for review"
          href={adminHref("/businesses?status=all")}
        />
        <StatCard
          label="Businesses approved"
          value={n(a.businesses_approved)}
          hint={`${n(a.approved_businesses_now)} approved in total`}
          href={adminHref("/businesses?status=approved")}
        />
      </StatGroup>

      <StatGroup title="Discovery">
        <StatCard
          label="Searches"
          value={n(a.searches)}
          hint={`${n(a.concierge_searches)} through the AI concierge`}
        />
        <StatCard label="AI conversations" value={n(a.ai_conversations)} hint="Concierge chats started" />
        <StatCard
          label="Provider matches"
          value={n(a.provider_matches)}
          hint={`${n(a.providers_matched)} different providers shown`}
        />
        <StatCard label="Profile views" value={n(a.profile_views)} />
      </StatGroup>

      <StatGroup title="Bookings">
        <StatCard label="Booking requests" value={n(a.booking_requests)} href={adminHref("/bookings")} />
        <StatCard label="Confirmed bookings" value={n(a.confirmed_bookings)} hint="Paid for" />
        <StatCard label="Completed bookings" value={n(a.completed_bookings)} />
        <StatCard
          label="Cancellations"
          value={n(a.cancellations)}
          tone={a.cancellations > 0 && a.cancellations >= a.completed_bookings ? "attention" : "neutral"}
        />
      </StatGroup>

      <StatGroup title="Money">
        <StatCard
          label="Customer payments"
          value={formatNaira(a.customer_payments_minor)}
          hint={`${n(a.paid_bookings)} paid bookings`}
          href={adminHref("/payments")}
        />
        <StatCard label="Platform commission" value={formatNaira(a.commission_minor)} />
        <StatCard
          label="Provider earnings"
          value={formatNaira(a.provider_earnings_minor)}
          hint="After commission"
        />
        <StatCard label="Average booking value" value={formatNaira(a.average_booking_minor)} />
      </StatGroup>
      <p className="-mt-5 text-sm text-muted">
        Platform revenue in this period was {formatNaira(platformRevenue)}: commission, plus{" "}
        {formatNaira(a.booking_fees_minor)} in customer booking fees and{" "}
        {formatNaira(a.business_charges_minor)} from business plans and featured placement.
        {a.refunded_minor > 0 && ` ${formatNaira(a.refunded_minor)} was refunded to customers.`}{" "}
        <Link href={adminHref("/revenue")} className="font-medium text-foreground underline">
          Revenue details
        </Link>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Conversion">
          <ul className="flex flex-col divide-y divide-border">
            {funnel.map((step) => (
              <li
                key={step.label}
                className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{step.label}</span>
                  <span className="block text-xs text-muted">{step.detail}</span>
                </span>
                <span className="shrink-0 text-lg font-semibold tabular-nums">{step.value}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Searches and booking requests">
          {trend.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <>
              <div className="flex gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-full bg-accent" /> Searches
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-full bg-foreground" /> Booking requests
                </span>
              </div>
              <ol className="flex flex-col gap-2" aria-label="By day">
                {trend.map((point) => (
                  <li key={point.day} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-xs">
                    <span className="truncate text-muted tabular-nums" title={point.label}>
                      {point.day.slice(5)}
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 rounded-full bg-accent"
                          style={{ width: `${(point.searches / trendMax) * 100}%`, minWidth: 2 }}
                        />
                        <span className="tabular-nums">{n(point.searches)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 rounded-full bg-foreground"
                          style={{ width: `${(point.booking_requests / trendMax) * 100}%`, minWidth: 2 }}
                        />
                        <span className="tabular-nums">{n(point.booking_requests)}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Panel>

        <BarList
          title="Popular categories"
          empty="No searches or bookings in this period."
          items={a.categories.map((c) => ({
            key: c.id,
            label: c.name,
            detail: `${n(c.searches)} searches · ${n(c.profile_views)} views`,
            value: c.booking_requests,
            display: `${n(c.booking_requests)} requests`,
          }))}
        />
        <BarList
          title="Popular locations"
          empty="No searches or bookings with a location in this period."
          items={a.locations.map((l) => ({
            key: `${l.state}:${l.city ?? ""}`,
            label: l.city && l.city !== l.state ? `${l.city}, ${l.state}` : l.state,
            detail: `${n(l.searches)} searches`,
            value: l.booking_requests + l.searches,
            display: `${n(l.booking_requests)} requests`,
          }))}
        />
      </div>

      <Panel title="What we record">
        <p className="text-sm text-muted">
          Searches, the providers each search showed, and profile views are counted without recording who made
          them: no names, accounts, IP addresses, devices or search wording. Only the category and the state
          or city the platform recognised are kept, and these events are deleted after two years. Everything
          else on this page comes from bookings, payments and sign-ups the platform already holds. Crawlers,
          link previews, admins and owners viewing their own profile are not counted.
        </p>
      </Panel>
    </div>
  );
}
