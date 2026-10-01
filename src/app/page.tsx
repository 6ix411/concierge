import { BadgeCheck, MessageCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { ConciergeBox } from "@/components/concierge/concierge-box";
import { Container } from "@/components/layout/container";
import { BusinessCard } from "@/components/marketplace/business-card";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { getCategories, searchBusinesses } from "@/lib/marketplace/queries";

const steps = [
  {
    title: "Tell us what you need",
    body: "Describe it in your own words: the service, where, when and your budget.",
  },
  {
    title: "Get matched",
    body: "The concierge recommends providers verified on Concierge. Never random listings.",
  },
  {
    title: "Book and pay securely",
    body: "Confirm your booking, pay safely, then chat with your provider directly.",
  },
];

const promises = [
  {
    icon: BadgeCheck,
    title: "Verified businesses only",
    body: "Every provider is checked and approved by our team.",
  },
  {
    icon: ShieldCheck,
    title: "Protected payments",
    body: "Pay through Concierge so your booking is covered.",
  },
  {
    icon: MessageCircle,
    title: "Talk directly",
    body: "Chat with your provider once your booking is confirmed.",
  },
];

export default async function HomePage() {
  const [categories, topRated] = await Promise.all([
    getCategories(),
    searchBusinesses({ sort: "rating", limit: 4 }),
  ]);

  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-surface-muted/60 to-background">
        <Container className="flex flex-col gap-6 py-10 sm:py-16">
          <div className="flex max-w-2xl flex-col gap-3">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Tell us what you need. We’ll find the right provider.
            </h1>
            <p className="text-base leading-relaxed text-muted sm:text-lg">
              Describe the job and our concierge matches you with verified businesses, then handles booking
              and payment.
            </p>
          </div>
          <div className="max-w-2xl">
            <ConciergeBox />
          </div>
        </Container>
      </section>

      <Container className="flex flex-col gap-12 py-10 sm:py-14">
        <section aria-labelledby="categories-heading" className="flex flex-col gap-4">
          <div className="flex items-end justify-between">
            <h2 id="categories-heading" className="text-xl font-semibold tracking-tight">
              Browse services
            </h2>
            <Link href="/services" className="text-sm font-medium text-muted hover:underline">
              All services
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/services/${category.slug}`}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-foreground/30"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted">
                  <CategoryIcon name={category.icon} className="size-5" />
                </span>
                <span className="text-sm leading-tight font-medium">{category.name}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-heading" className="flex flex-col gap-4">
          <h2 id="how-heading" className="text-xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-border bg-surface p-5">
                <span className="font-mono text-xs text-accent">0{index + 1}</span>
                <p className="mt-2 font-semibold">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {topRated.length > 0 && (
          <section aria-labelledby="top-heading" className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <h2 id="top-heading" className="text-xl font-semibold tracking-tight">
                Top-rated providers
              </h2>
              <Link href="/search?sort=rating" className="text-sm font-medium text-muted hover:underline">
                See more
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {topRated.map((business) => (
                <BusinessCard key={business.id} business={business} compare={false} />
              ))}
            </div>
          </section>
        )}

        <section
          aria-labelledby="provider-heading"
          className="flex flex-col gap-3 rounded-2xl bg-brand p-6 text-brand-foreground sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2 id="provider-heading" className="text-lg font-semibold">
              Run a business?
            </h2>
            <p className="text-sm opacity-80">
              Get verified and matched with customers looking for what you do.
            </p>
          </div>
          <Link
            href="/become-a-provider"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Become a Provider
          </Link>
        </section>

        <section aria-label="Why Concierge" className="grid gap-3 sm:grid-cols-3">
          {promises.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-verified" />
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted">{body}</p>
              </div>
            </div>
          ))}
        </section>
      </Container>
    </>
  );
}
