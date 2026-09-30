import { Container } from "@/components/layout/container";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui";

const steps = [
  { title: "Understand", body: "Tell the concierge what you need, in your own words." },
  { title: "Match", body: "It searches only businesses registered and approved on this platform." },
  { title: "Book", body: "Pick a provider, book and pay securely. Then chat with them directly." },
];

export default function HomePage() {
  return (
    <Container className="flex flex-col gap-10 py-10 sm:py-16">
      <section className="flex flex-col gap-4">
        <Badge tone="verified" className="self-start">
          Verified businesses only
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          Tell us what you need. We’ll find someone you can trust.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          Concierge matches you with businesses our team has checked and approved, then handles booking and
          payment.
        </p>
      </section>

      <section aria-label="How it works" className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <Card key={step.title}>
            <span className="font-mono text-xs text-accent">0{index + 1}</span>
            <CardTitle className="mt-2">{step.title}</CardTitle>
            <CardDescription>{step.body}</CardDescription>
          </Card>
        ))}
      </section>
    </Container>
  );
}
