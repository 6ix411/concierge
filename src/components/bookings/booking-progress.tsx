import { Check } from "lucide-react";

import { bookingStatusLabels, type BookingStatus } from "@/lib/bookings/rules";
import { flowPosition, mainFlow, stepLabels } from "@/lib/bookings/workflow";
import { cn } from "@/lib/utils/cn";

const offPath: Partial<Record<BookingStatus, string>> = {
  declined: "The business declined this booking.",
  cancelled: "This booking was cancelled.",
  expired: "This booking expired before it was confirmed.",
  disputed: "A problem was reported. The Concierge team is looking into it.",
  refunded: "This booking was cancelled and the payment refunded.",
};

/** Where the booking is in requested → … → reviewed, with a note when it left that path. */
export function BookingProgress({
  status,
  reached,
}: {
  status: BookingStatus;
  /** Statuses from the booking's history, to show how far it got before leaving the main path. */
  reached: BookingStatus[];
}) {
  const position = flowPosition(status, reached);
  const stopped = offPath[status];
  return (
    <section aria-label="Booking progress" className="flex flex-col gap-3">
      <ol className="grid grid-cols-4 gap-x-1 gap-y-3 sm:grid-cols-8">
        {mainFlow.map((step, index) => {
          const done = index < position || (index === position && step === "reviewed");
          const current = index === position && !stopped && !done;
          return (
            <li key={step} className="flex flex-col gap-1.5" aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "h-1.5 rounded-full",
                  done || current ? "bg-foreground" : "bg-border",
                  current && "animate-pulse",
                  stopped && index === position && "bg-danger",
                )}
              />
              <span
                className={cn(
                  "flex items-start gap-1 text-xs leading-tight",
                  current ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted",
                )}
              >
                {done && <Check aria-hidden className="mt-px size-3 shrink-0" />}
                {stepLabels[step]}
              </span>
            </li>
          );
        })}
      </ol>
      {stopped && (
        <p className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
          <span className="font-medium">{bookingStatusLabels[status]}.</span> {stopped}
        </p>
      )}
    </section>
  );
}
