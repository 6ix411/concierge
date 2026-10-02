import type { Metadata } from "next";

import { FormMessage } from "@/components/auth/form-message";
import { CheckoutButton } from "@/components/bookings/checkout-button";
import { ChargeHistory } from "@/components/business/charge-history";
import { Badge } from "@/components/ui";
import { requireOwnBusiness } from "@/lib/business/queries";
import { formatDate, formatNaira } from "@/lib/format";
import { startBusinessCheckoutAction } from "@/lib/revenue/actions";
import { getBusinessBilling, getFeaturedPackages } from "@/lib/revenue/queries";

export const metadata: Metadata = { title: "Get featured" };

const paymentMessages = {
  success: { tone: "success", text: "Payment received. Your business is featured." },
  failed: { tone: "error", text: "The payment didn’t go through, so nothing changed. You can try again." },
  error: {
    tone: "error",
    text: "We couldn’t confirm the payment yet. If you were charged, it will show here shortly.",
  },
} as const;

export default async function BusinessPromotePage({ searchParams }: PageProps<"/business/promote">) {
  const { business } = await requireOwnBusiness();
  const [packages, billing, { payment }] = await Promise.all([
    getFeaturedPackages(),
    getBusinessBilling(business.id),
    searchParams,
  ]);
  const notice =
    typeof payment === "string" ? paymentMessages[payment as keyof typeof paymentMessages] : null;
  const { featuredNow, featuredUntil } = billing;
  const eligible = business.status === "approved" && business.is_verified && business.accepting_bookings;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Get featured</h1>
        <p className="mt-1 text-muted">Be shown first to customers you’re a great fit for.</p>
      </div>
      {notice && <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <p className="font-semibold">{featuredNow ? "You’re featured" : "Not featured"}</p>
          {featuredNow && <Badge tone="accent">Featured</Badge>}
        </div>
        <p className="text-sm text-muted">
          {featuredUntil ? `Until ${formatDate(featuredUntil)}.` : "Choose an option below to start."}
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-surface-muted p-4 text-sm">
        <h2 className="font-semibold">How it works</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>
            When a customer searches or asks the AI Concierge, you’re shown at the top only if you already
            meet everything they asked for: the service, area, date, budget and group size.
          </li>
          <li>Paying never puts you in front of customers you don’t match, and never changes your rating.</li>
          <li>Your card shows a “Featured” label, so customers know it’s a paid placement.</li>
          <li>A few featured providers can be at the top at once; the best match among them goes first.</li>
        </ul>
      </section>

      {!eligible && (
        <p className="rounded-xl bg-surface-muted px-4 py-3 text-muted">
          Featured placement is available once your business is approved, verified and taking bookings.
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {packages.map((pkg) => (
          <li
            key={pkg.code}
            data-testid={`featured-${pkg.code}`}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
          >
            <h2 className="font-semibold">{pkg.name}</h2>
            <p className="text-xl font-semibold tabular-nums">{formatNaira(pkg.price_minor)}</p>
            <p className="text-sm text-muted">
              {pkg.duration_days} days of featured placement
              {featuredUntil ? ", starting when your current placement ends." : ", starting today."}
            </p>
            {eligible && (
              <CheckoutButton
                action={startBusinessCheckoutAction.bind(null, "featured", pkg.code)}
                label={`Pay ${formatNaira(pkg.price_minor)}`}
                size="md"
              />
            )}
          </li>
        ))}
      </ul>

      <ChargeHistory charges={billing.charges} />
    </div>
  );
}
