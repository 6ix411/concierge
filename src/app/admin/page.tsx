import type { Metadata } from "next";
import Link from "next/link";

import { BarList, PageHeader, Panel, StatCard, StatGroup } from "@/components/admin/dashboard-widgets";
import { getAdminStats } from "@/lib/admin/stats";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { formatNaira, formatNairaShort } from "@/lib/format";

export const metadata: Metadata = { title: "Admin" };

const number = new Intl.NumberFormat("en-NG");
const monthName = new Intl.DateTimeFormat("en-NG", { month: "short", timeZone: "UTC" });

function plural(count: number, word: string) {
  const many = word.endsWith("s") ? `${word}es` : `${word}s`;
  return `${number.format(count)} ${count === 1 ? word : many}`;
}

export default async function AdminOverviewPage() {
  await requireAreaAccess("admin");
  const stats = await getAdminStats();
  const maxMonth = Math.max(1, ...stats.monthly.map((m) => m.revenue_minor));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Admin" description="How the marketplace is doing, and what needs your attention." />

      <StatGroup title="Needs attention">
        <StatCard
          label="Providers to review"
          value={number.format(stats.pending_businesses)}
          href={adminHref("/businesses?status=review")}
          tone={stats.pending_businesses > 0 ? "attention" : "neutral"}
        />
        <StatCard
          label="Open disputes"
          value={number.format(stats.open_disputes)}
          hint={`${plural(stats.disputes, "dispute")} in total`}
          href={adminHref("/disputes")}
          tone={stats.open_disputes > 0 ? "attention" : "neutral"}
        />
        <StatCard
          label="Pending payouts"
          value={formatNaira(stats.pending_payouts_minor)}
          hint={plural(stats.pending_payouts, "payout")}
        />
        <StatCard
          label="Reviews"
          value={number.format(stats.reviews)}
          hint={[
            stats.average_rating ? `${stats.average_rating.toFixed(1)} average` : null,
            stats.hidden_reviews ? `${stats.hidden_reviews} hidden` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          href={adminHref("/reviews")}
        />
      </StatGroup>

      <StatGroup title="Marketplace">
        <StatCard
          label="Customers"
          value={number.format(stats.customers)}
          href={adminHref("/users?role=customer")}
        />
        <StatCard
          label="Businesses"
          value={number.format(stats.businesses)}
          hint="Submitted for review or later"
          href={adminHref("/businesses?status=all")}
        />
        <StatCard
          label="Pending businesses"
          value={number.format(stats.pending_businesses)}
          hint="Pending or under review"
          href={adminHref("/businesses?status=review")}
        />
        <StatCard
          label="Approved businesses"
          value={number.format(stats.approved_businesses)}
          href={adminHref("/businesses?status=approved")}
        />
      </StatGroup>

      <StatGroup title="Bookings and money">
        <StatCard
          label="Active bookings"
          value={number.format(stats.active_bookings)}
          hint="Requests, upcoming and in progress"
          href={adminHref("/bookings?status=active")}
        />
        <StatCard
          label="Completed bookings"
          value={number.format(stats.completed_bookings)}
          href={adminHref("/bookings?status=completed")}
        />
        <StatCard
          label="Cancelled bookings"
          value={number.format(stats.cancelled_bookings)}
          href={adminHref("/bookings?status=cancelled")}
        />
        <StatCard
          label="Revenue"
          value={formatNaira(stats.revenue_minor)}
          hint="Paid by customers, less refunds"
        />
        <StatCard
          label="Platform fees"
          value={formatNaira(stats.platform_fees_minor)}
          hint="Commission earned"
          href={adminHref("/commission")}
        />
      </StatGroup>

      <Panel title="Revenue, last six months">
        <div className="flex h-40 items-end gap-2 sm:gap-4" role="img" aria-label="Monthly revenue chart">
          {stats.monthly.map((m) => (
            <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs text-muted tabular-nums">{formatNairaShort(m.revenue_minor)}</span>
              <div
                className="w-full max-w-12 rounded-t-lg bg-accent"
                style={{ height: `${Math.max(2, (m.revenue_minor / maxMonth) * 100)}%` }}
              />
              <span className="text-xs text-muted">
                {monthName.format(new Date(`${m.month}-01T00:00:00Z`))}
              </span>
            </div>
          ))}
        </div>
        <ul className="sr-only">
          {stats.monthly.map((m) => (
            <li key={m.month}>
              {m.month}: {formatNaira(m.revenue_minor)} from {plural(m.bookings, "new booking")}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <BarList
          title="Popular categories"
          empty="No paid bookings yet."
          items={stats.popular_categories.map((c) => ({
            key: c.id,
            label: c.name,
            detail: plural(c.businesses, "business"),
            value: c.bookings,
            display: plural(c.bookings, "booking"),
          }))}
        />
        <BarList
          title="Popular services"
          empty="No paid bookings yet."
          items={stats.popular_services.map((s) => ({
            key: s.id,
            label: s.name,
            detail: s.business_name,
            value: s.bookings,
            display: plural(s.bookings, "booking"),
          }))}
        />
        <BarList
          title="Most-booked businesses"
          empty="No paid bookings yet."
          items={stats.top_businesses.map((b) => ({
            key: b.id,
            label: (
              <Link href={adminHref(`/businesses/${b.id}`)} className="hover:underline">
                {b.name}
              </Link>
            ),
            detail: formatNairaShort(b.value_minor),
            value: b.bookings,
            display: plural(b.bookings, "booking"),
          }))}
        />
      </div>
      <p className="text-xs text-muted">
        Popularity counts paid bookings (confirmed, in progress, completed or disputed).
      </p>
    </div>
  );
}
