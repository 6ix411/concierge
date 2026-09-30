/** Nigeria is UTC+1 all year (no daylight saving). */
export const LAGOS_OFFSET = "+01:00";

/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-07" + "14:30" in Lagos → Date. */
export function lagosDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${LAGOS_OFFSET}`);
}

/** Split a timestamp into Lagos-local date and HH:MM. */
export function toLagosParts(value: string | Date): { date: string; time: string } {
  const d = new Date(value);
  const date = lagosToday(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}
