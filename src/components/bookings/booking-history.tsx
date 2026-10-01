import {
  describeActor,
  describeEvent,
  sortEvents,
  type BookingEvent,
  type HistoryViewer,
} from "@/lib/bookings/workflow";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/** The booking's full history, oldest first, from the booking_events table. */
export function BookingHistory({
  events,
  viewer,
  names,
  className,
}: {
  events: BookingEvent[];
  viewer: HistoryViewer;
  names: { customer: string; business: string };
  className?: string;
}) {
  const sorted = sortEvents(events);
  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-4", className)}>
      <h2 className="mb-3 text-sm font-semibold">History</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">No history yet.</p>
      ) : (
        <ol className="flex flex-col">
          {sorted.map((event, index) => {
            const actor = describeActor(event.actor_role, viewer, names);
            return (
              <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                {index < sorted.length - 1 && (
                  <span aria-hidden className="absolute top-3 bottom-0 left-[5px] w-px bg-border" />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-surface",
                    index === sorted.length - 1 ? "bg-foreground" : "bg-border",
                  )}
                />
                <div className="flex min-w-0 flex-col text-sm">
                  <span className="font-medium">{describeEvent(event)}</span>
                  <span className="text-xs text-muted">
                    {formatDateTime(event.created_at)}
                    {actor && ` · ${actor}`}
                  </span>
                  {event.note && event.event !== "created" && (
                    <span className="mt-0.5 text-muted">“{event.note}”</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
