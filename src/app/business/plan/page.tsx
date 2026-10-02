import { Check } from "lucide-react";
import type { Metadata } from "next";

import { FormMessage } from "@/components/auth/form-message";
import { CheckoutButton } from "@/components/bookings/checkout-button";
import { ChargeHistory } from "@/components/business/charge-history";
import { Badge } from "@/components/ui";
import { requireOwnBusiness } from "@/lib/business/queries";
import { formatDate } from "@/lib/format";
import { startBusinessCheckoutAction } from "@/lib/revenue/actions";
import { getBusinessBilling, getPlans } from "@/lib/revenue/queries";
import { planPriceLabel } from "@/lib/revenue/rules";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Your plan" };

const paymentMessages = {
  success: { tone: "success", text: "Payment received. Your plan is active." },
  failed: { tone: "error", text: "The payment didn’t go through, so nothing changed. You can try again." },
  error: {
    tone: "error",
    text: "We couldn’t confirm the payment yet. If you were charged, it will show here shortly.",
  },
} as const;

export default async function BusinessPlanPage({ searchParams }: PageProps<"/business/plan">) {
  const { business } = await requireOwnBusiness();
  const [plans, billing, { payment }] = await Promise.all([
    getPlans(),
    getBusinessBilling(business.id),
    searchParams,
  ]);
  const notice =
    typeof payment === "string" ? paymentMessages[payment as keyof typeof paymentMessages] : null;
  const current = plans.find((plan) => plan.code === billing.planCode) ?? plans[0];
  const paidUntil = billing.periods.at(-1)?.period_end ?? null;
  const approved = business.status === "approved";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your plan</h1>
        <p className="mt-1 text-muted">
          Every plan can take bookings. Paid plans are billed monthly, and you can renew any time.
        </p>
      </div>
      {notice && <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div>
          <p className="text-sm text-muted">Current plan</p>
          <p className="text-lg font-semibold">{current?.name ?? "Free"}</p>
        </div>
        <p className="text-sm text-muted">
          {paidUntil
            ? `Paid until ${formatDate(paidUntil)}. After that you move to Free unless you renew.`
            : "No payment needed."}
        </p>
      </section>

      {!approved && (
        <p className="rounded-xl bg-surface-muted px-4 py-3 text-muted">
          You can choose a paid plan once your business is approved.
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.code === billing.planCode;
          return (
            <li
              key={plan.code}
              data-testid={`plan-${plan.code}`}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border bg-surface p-4",
                isCurrent ? "border-foreground" : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{plan.name}</h2>
                {isCurrent && <Badge tone="verified">Current</Badge>}
              </div>
              <p className="text-xl font-semibold tabular-nums">{planPriceLabel(plan.monthly_price_minor)}</p>
              {plan.description && <p className="text-sm text-muted">{plan.description}</p>}
              <ul className="flex flex-1 flex-col gap-1 text-sm">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
                    {perk}
                  </li>
                ))}
              </ul>
              {plan.monthly_price_minor > 0 && approved && (
                <CheckoutButton
                  action={startBusinessCheckoutAction.bind(null, "subscription", plan.code)}
                  label={isCurrent ? "Renew for a month" : `Choose ${plan.name}`}
                  size="md"
                  variant={isCurrent ? "outline" : "primary"}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        Renewing adds a month after your current one ends. Choosing a different plan starts it today, and any
        time left on your current plan isn’t refunded.
      </p>

      <ChargeHistory charges={billing.charges} />
    </div>
  );
}
