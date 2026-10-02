import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader, Panel, StatCard } from "@/components/admin/dashboard-widgets";
import {
  BookingFeeForm,
  FeaturedPackageForm,
  FeaturedSlotsForm,
  PlanForm,
} from "@/components/admin/revenue-forms";
import { COMMISSION_SETTING, formatBps } from "@/lib/admin/rules";
import {
  updateBookingFeeAction,
  updateFeaturedPackageAction,
  updateFeaturedSlotsAction,
  updatePlanAction,
} from "@/lib/admin/revenue-actions";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { bookingFeeFor } from "@/lib/bookings/rules";
import { AppError } from "@/lib/errors";
import { formatDate, formatNaira } from "@/lib/format";
import { getBookingFeeRule, getFeaturedSlots, periodStart } from "@/lib/revenue/queries";
import { describeBookingFee, planPriceLabel } from "@/lib/revenue/rules";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Revenue" };

const periods = {
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
  "12m": { label: "Last 12 months", days: 365 },
  all: { label: "All time", days: null },
} as const;
type Period = keyof typeof periods;

export default async function AdminRevenuePage({ searchParams }: PageProps<"/admin/revenue">) {
  await requireAreaAccess("admin");
  const { period: raw } = await searchParams;
  const period: Period = typeof raw === "string" && raw in periods ? (raw as Period) : "30d";
  const days = periods[period].days;
  const from = periodStart(days);

  const db = createAdminClient();
  const [summary, plans, packages, charges, commission, bookingFee, slots] = await Promise.all([
    db.rpc("get_revenue_summary", { p_from: from.toISOString(), p_to: "infinity" }).single(),
    db
      .from("subscription_plans")
      .select("code, name, description, monthly_price_minor, commission_rate_bps, perks, is_active")
      .order("sort_order"),
    db
      .from("featured_packages")
      .select("code, name, duration_days, price_minor, is_active")
      .order("sort_order"),
    db
      .from("business_charges")
      .select(
        "id, kind, item_code, reference, amount_minor, status, paid_at, created_at, businesses(id, name)",
      )
      .order("created_at", { ascending: false })
      .limit(15),
    db.from("platform_settings").select("value").eq("key", COMMISSION_SETTING).maybeSingle(),
    getBookingFeeRule(),
    getFeaturedSlots(),
  ]);
  const error = summary.error ?? plans.error ?? packages.error ?? charges.error;
  if (error) throw new AppError("INTERNAL", "Could not load revenue.", { cause: error });
  const s = summary.data!;
  const total = s.commission_minor + s.booking_fees_minor + s.subscriptions_minor + s.featured_minor;
  const example = 100_000_00;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Revenue"
        description="What the platform earns from each stream, and the prices businesses and customers pay."
      />
      <FilterTabs
        label="Period"
        current={period}
        tabs={Object.entries(periods).map(([key, value]) => ({
          key,
          label: value.label,
          href: adminHref(`/revenue?period=${key}`),
        }))}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total" value={formatNaira(total)} hint={periods[period].label} />
        <StatCard
          label="Booking commission"
          value={formatNaira(s.commission_minor)}
          hint={`${s.paid_bookings} paid bookings`}
        />
        <StatCard label="Customer booking fees" value={formatNaira(s.booking_fees_minor)} />
        <StatCard
          label="Subscriptions"
          value={formatNaira(s.subscriptions_minor)}
          hint={`${s.active_subscriptions} on a paid plan now`}
        />
        <StatCard
          label="Featured placement"
          value={formatNaira(s.featured_minor)}
          hint={`${s.active_featured} featured now`}
        />
      </div>
      {s.refunded_minor > 0 && (
        <p className="text-sm text-muted">
          {formatNaira(s.refunded_minor)} was refunded to customers in this period. Commission and fees above
          are before refunds.
        </p>
      )}

      <Panel title="Booking commission">
        <p className="text-sm text-muted">
          The platform rate is {formatBps(Number(commission.data?.value ?? 0))} of the service price, taken
          from the business’s payout. A plan can set its own rate, and a business can have a custom rate,
          which wins over both.{" "}
          <Link href={adminHref("/commission")} className="font-medium text-foreground underline">
            Change commission
          </Link>
        </p>
      </Panel>

      <Panel title="Customer booking fee">
        <p className="text-sm text-muted">
          Now: <span className="font-medium text-foreground">{describeBookingFee(bookingFee)}</span>.
          {bookingFee.percentBps > 0 || bookingFee.flatMinor > 0
            ? ` On a ${formatNaira(example)} booking, the customer pays ${formatNaira(bookingFeeFor(example, bookingFee))} on top.`
            : ""}{" "}
          Customers see it before they book and at checkout. The platform keeps all of it and takes no
          commission on it. Changes apply to new bookings and new quotes only.
        </p>
        <BookingFeeForm action={updateBookingFeeAction} fee={bookingFee} />
      </Panel>

      <Panel title="Subscription plans">
        <p className="text-sm text-muted">
          Businesses pay monthly. Price changes apply to the next payment; months already paid for keep their
          price.
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {(plans.data ?? []).map((plan) => (
            <li key={plan.code} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
              <h3 className="font-medium">
                {plan.name} · {planPriceLabel(plan.monthly_price_minor)}
                {!plan.is_active && <span className="text-muted"> (not offered)</span>}
              </h3>
              <PlanForm action={updatePlanAction} plan={plan} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Featured placement">
        <p className="text-sm text-muted">
          Featured providers are only shown first among providers that already meet every requirement of a
          search. Paying never makes a provider appear for a customer it doesn’t match.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(packages.data ?? []).map((pkg) => (
            <FeaturedPackageForm key={pkg.code} action={updateFeaturedPackageAction} pkg={pkg} />
          ))}
        </div>
        <FeaturedSlotsForm action={updateFeaturedSlotsAction} slots={slots} />
      </Panel>

      <Panel title="Recent business payments">
        {(charges.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No plan or featured placement payments yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Business</th>
                  <th className="py-2 pr-3 font-medium">For</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(charges.data ?? []).map((charge) => (
                  <tr key={charge.id} className="border-t border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDate(charge.paid_at ?? charge.created_at)}
                    </td>
                    <td className="py-2 pr-3">
                      {charge.businesses ? (
                        <Link
                          href={adminHref(`/businesses/${charge.businesses.id}`)}
                          className="font-medium hover:underline"
                        >
                          {charge.businesses.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 capitalize">
                      {charge.kind === "subscription" ? "Plan" : "Featured"} · {charge.item_code}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNaira(charge.amount_minor)}</td>
                    <td className="py-2">{charge.status === "success" ? "Paid" : charge.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
