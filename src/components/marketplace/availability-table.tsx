import type { AvailabilityRule } from "@/lib/bookings/rules";
import { formatTime, weekdayNames } from "@/lib/format";

/** Weekly hours, Monday first. */
export function AvailabilityTable({ rules }: { rules: AvailabilityRule[] }) {
  const weekly = rules.filter((rule) => rule.day_of_week !== null);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <dl className="divide-y divide-border text-sm">
      {order.map((day) => {
        const slots = weekly
          .filter((rule) => rule.day_of_week === day && rule.is_available && rule.start_time && rule.end_time)
          .sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1));
        return (
          <div key={day} className="flex justify-between gap-4 py-2">
            <dt className="text-muted">{weekdayNames[day]}</dt>
            <dd className="text-right">
              {slots.length > 0
                ? slots
                    .map((slot) => `${formatTime(slot.start_time!)} – ${formatTime(slot.end_time!)}`)
                    .join(", ")
                : "Closed"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
