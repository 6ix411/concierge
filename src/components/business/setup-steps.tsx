import { Check } from "lucide-react";
import Link from "next/link";

import { onboardingSteps, type OnboardingStep } from "@/lib/business/onboarding";
import { cn } from "@/lib/utils/cn";

/** Registration progress. Each step links to its page; finished steps show a tick. */
export function SetupSteps({
  progress,
  current,
  hrefFor,
}: {
  progress: Record<OnboardingStep, boolean> | null;
  current: OnboardingStep | "review";
  hrefFor: (step: OnboardingStep | "review") => string | null;
}) {
  const done = progress ? onboardingSteps.filter((step) => progress[step.key]).length : 0;
  return (
    <nav aria-label="Registration steps" className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {done} of {onboardingSteps.length} steps done
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(done / onboardingSteps.length) * 100}%` }}
        />
      </div>
      <ol className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
        {[...onboardingSteps, { key: "review" as const, title: "Submit", description: "" }].map(
          (step, index) => {
            const complete = step.key !== "review" && progress?.[step.key];
            const active = step.key === current;
            const href = hrefFor(step.key);
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    complete
                      ? "bg-verified text-white"
                      : active
                        ? "bg-brand text-brand-foreground"
                        : "bg-surface-muted text-muted",
                  )}
                >
                  {complete ? <Check aria-hidden className="size-3" /> : index + 1}
                </span>
                {step.title}
              </>
            );
            const className = cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
              active ? "border-foreground font-medium" : "border-border text-muted",
            );
            return (
              <li key={step.key}>
                {href ? (
                  <Link
                    href={href}
                    aria-current={active ? "step" : undefined}
                    className={cn(className, "hover:bg-surface-muted")}
                  >
                    {content}
                    {complete && <span className="sr-only">(done)</span>}
                  </Link>
                ) : (
                  <span className={className}>{content}</span>
                )}
              </li>
            );
          },
        )}
      </ol>
    </nav>
  );
}
