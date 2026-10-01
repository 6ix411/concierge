"use client";

import { CalendarX, X } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input } from "@/components/ui";
import {
  addDayOffAction,
  removeAvailabilityAction,
  saveBookingSettingsAction,
  saveWeeklyHoursAction,
} from "@/lib/business/actions";
import { formatDate, weekdayNames } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

type Rule = {
  id: string;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
};

// Monday first, the way most people read a week.
const weekOrder = [1, 2, 3, 4, 5, 6, 0];
const hhmm = (time: string | null | undefined) => (time ? time.slice(0, 5) : "");

/** Opening days and hours for each day of the week. */
export function WeeklyHoursForm({ rules, next }: { rules: Rule[]; next?: string }) {
  const [state, formAction, pending] = useActionState(saveWeeklyHoursAction, { status: "idle" });
  const weekly = new Map(
    rules.filter((r) => r.day_of_week !== null).map((r) => [r.day_of_week as number, r]),
  );
  const firstTime = rules.length === 0;
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(
      weekOrder.map((day) => [
        day,
        firstTime ? day >= 1 && day <= 6 : Boolean(weekly.get(day)?.is_available),
      ]),
    ),
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
        {weekOrder.map((day) => {
          const rule = weekly.get(day);
          const error = state.fieldErrors?.[`day-${day}`];
          return (
            <li key={day} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
              <label className="flex w-36 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`open-${day}`}
                  checked={open[day]}
                  onChange={(event) => setOpen((current) => ({ ...current, [day]: event.target.checked }))}
                  className="size-4 accent-foreground"
                />
                {weekdayNames[day]}
              </label>
              {open[day] ? (
                <div className="flex items-center gap-2 text-sm">
                  <label className="sr-only" htmlFor={`start-${day}`}>
                    {weekdayNames[day]} opening time
                  </label>
                  <input
                    id={`start-${day}`}
                    type="time"
                    name={`start-${day}`}
                    step={900}
                    defaultValue={state.values?.[`start-${day}`] ?? (hhmm(rule?.start_time) || "09:00")}
                    className={cn(
                      "h-10 rounded-lg border border-border bg-surface px-2",
                      error && "border-danger",
                    )}
                  />
                  <span className="text-muted">to</span>
                  <label className="sr-only" htmlFor={`end-${day}`}>
                    {weekdayNames[day]} closing time
                  </label>
                  <input
                    id={`end-${day}`}
                    type="time"
                    name={`end-${day}`}
                    step={900}
                    defaultValue={state.values?.[`end-${day}`] ?? (hhmm(rule?.end_time) || "18:00")}
                    className={cn(
                      "h-10 rounded-lg border border-border bg-surface px-2",
                      error && "border-danger",
                    )}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted">Closed</span>
              )}
              {error && <p className="text-sm text-danger">{error}</p>}
            </li>
          );
        })}
      </ul>
      <Button type="submit" loading={pending} className="self-start">
        {next ? "Save and continue" : "Save hours"}
      </Button>
    </form>
  );
}

/** Whether the business takes bookings, and how much notice and how far ahead. */
export function BookingSettingsForm({
  settings,
}: {
  settings: {
    accepting_bookings: boolean;
    min_notice_hours: number;
    booking_window_days: number;
    max_bookings_per_day: number | null;
  };
}) {
  const [state, formAction, pending] = useActionState(saveBookingSettingsAction, { status: "idle" });
  const value = (key: string, saved: string) => state.values?.[key] ?? saved;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <label className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
        <input
          type="checkbox"
          name="acceptingBookings"
          defaultChecked={
            state.values ? state.values.acceptingBookings === "on" : settings.accepting_bookings
          }
          className="mt-0.5 size-4 accent-foreground"
        />
        <span>
          <span className="block text-sm font-medium">Accepting new bookings</span>
          <span className="block text-sm text-muted">
            Turn this off to pause new requests, for example when you’re fully booked or on holiday.
          </span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Minimum notice (hours)"
          name="minNoticeHours"
          type="number"
          min={0}
          max={720}
          defaultValue={value("minNoticeHours", String(settings.min_notice_hours))}
          hint="How soon before the start a customer can book."
          error={errors.minNoticeHours}
        />
        <Input
          label="Book up to (days ahead)"
          name="bookingWindowDays"
          type="number"
          min={1}
          max={730}
          defaultValue={value("bookingWindowDays", String(settings.booking_window_days))}
          error={errors.bookingWindowDays}
        />
        <Input
          label="Most jobs per day (optional)"
          name="maxBookingsPerDay"
          type="number"
          min={1}
          max={100}
          defaultValue={value(
            "maxBookingsPerDay",
            settings.max_bookings_per_day ? String(settings.max_bookings_per_day) : "",
          )}
          hint="Leave empty for no limit."
          error={errors.maxBookingsPerDay}
        />
      </div>
      <Button type="submit" variant="outline" loading={pending} className="self-start">
        Save booking settings
      </Button>
    </form>
  );
}

/** One-off days the business is closed (holidays, other commitments). */
export function DaysOffEditor({ rules, minDate }: { rules: Rule[]; minDate: string }) {
  const [state, formAction, pending] = useActionState(addDayOffAction, { status: "idle" });
  const daysOff = rules
    .filter((r) => r.specific_date && !r.is_available && r.specific_date >= minDate)
    .sort((a, b) => (a.specific_date ?? "").localeCompare(b.specific_date ?? ""));
  return (
    <div className="flex flex-col gap-4">
      {daysOff.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Days off">
          {daysOff.map((rule) => (
            <li
              key={rule.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-3 text-sm"
            >
              <CalendarX aria-hidden className="size-3.5 text-muted" />
              {formatDate(`${rule.specific_date}T12:00:00+01:00`)}
              <form action={removeAvailabilityAction.bind(null, rule.id)}>
                <button
                  type="submit"
                  aria-label={`Remove day off on ${rule.specific_date}`}
                  className="rounded-full p-1 text-muted hover:bg-surface-muted hover:text-foreground"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No days off coming up.</p>
      )}
      <form action={formAction} className="flex items-end gap-3" noValidate>
        <div className="flex-1 sm:max-w-xs">
          <Input
            label="Add a day off"
            name="date"
            type="date"
            min={minDate}
            error={state.fieldErrors?.date}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          loading={pending}
          className={state.fieldErrors?.date ? "mb-6" : ""}
        >
          Add
        </Button>
      </form>
      {state.message && state.status === "error" && <FormMessage tone="error">{state.message}</FormMessage>}
    </div>
  );
}
