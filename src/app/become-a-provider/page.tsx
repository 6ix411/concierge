import { BadgeCheck, CalendarCheck, MessageCircle, Sparkles, Wallet } from "lucide-react";
import type { Metadata } from "next";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Container } from "@/components/layout/container";
import { LinkButton } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Become a Provider",
  description: "List your business on Concierge and get matched with customers looking for what you do.",
};

const benefits = [
  {
    icon: Sparkles,
    title: "Matched by our concierge",
    body: "Customers describe what they need and our concierge recommends verified providers like you.",
  },
  {
    icon: BadgeCheck,
    title: "A verified badge",
    body: "Every provider is checked by our team, so customers book you with confidence.",
  },
  {
    icon: Wallet,
    title: "Paid securely",
    body: "Customers pay on Concierge before the job. You get paid when it’s done.",
  },
  {
    icon: CalendarCheck,
    title: "Bookings in one place",
    body: "Requests, quotes, your calendar, chat, earnings and reviews in one dashboard.",
  },
];

const steps = [
  { title: "Register", body: "Tell us about your business, where you work and how to reach you." },
  { title: "Add your services", body: "Services, packages, add-ons and prices, plus your working hours." },
  { title: "Get verified", body: "Upload your logo, photos of your work and your CAC certificate or ID." },
  { title: "Start getting bookings", body: "Once our team approves you, customers can find and book you." },
];

export default async function BecomeAProviderPage() {
  const user = await getSessionUser().catch(() => null);

  let cta: React.ReactNode;
  if (!user) {
    cta = (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <LinkButton href="/sign-up?as=business" size="lg" variant="accent">
          Become a Provider
        </LinkButton>
        <LinkButton href="/sign-in?next=%2Fbusiness%2Fsetup" size="lg" variant="ghost">
          I already have a business account
        </LinkButton>
      </div>
    );
  } else if (user.role === "business") {
    cta = (
      <LinkButton href="/business" size="lg" variant="accent" className="self-start">
        Go to your dashboard
      </LinkButton>
    );
  } else if (user.role === "customer") {
    cta = (
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
        <p>
          You’re signed in as a customer. Provider accounts are separate, so sign out and create a business
          account to list your business.
        </p>
        <SignOutButton />
      </div>
    );
  }

  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-surface-muted/60 to-background">
        <Container className="flex flex-col gap-6 py-12 sm:py-20">
          <p className="text-sm font-medium text-accent">For businesses</p>
          <h1 className="max-w-2xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Get matched with customers who need what you do.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Join Nigeria’s verified marketplace for events, home, beauty and more. Free to join; we only take
            a commission when you get paid.
          </p>
          {cta}
        </Container>
      </section>

      <Container className="flex flex-col gap-12 py-10 sm:py-14">
        <section aria-labelledby="benefits-heading" className="flex flex-col gap-4">
          <h2 id="benefits-heading" className="text-xl font-semibold tracking-tight">
            Why list on Concierge
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {benefits.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3 rounded-2xl border border-border bg-surface p-4">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="steps-heading" className="flex flex-col gap-4">
          <h2 id="steps-heading" className="text-xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
              >
                <span className="font-mono text-xs text-accent">0{index + 1}</span>
                <p className="font-semibold">{step.title}</p>
                <p className="text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl bg-surface-muted p-6">
          <h2 className="text-lg font-semibold">What you’ll need</h2>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <li>Your business name, category, phone or email and location</li>
            <li>The areas you serve and your working hours</li>
            <li>Your services and prices (packages and add-ons too)</li>
            <li>Your logo and photos or videos of past work</li>
            <li>Your CAC certificate, or a government ID if you’re not registered</li>
          </ul>
          <p className="flex items-center gap-2 text-sm text-muted">
            <MessageCircle aria-hidden className="size-4" />
            Customers chat with you directly once a booking is confirmed.
          </p>
        </section>
      </Container>
    </>
  );
}
