/**
 * Analytics helpers shared by the trackers and the dashboards. Pure functions, no database.
 *
 * What we record is deliberately thin: an event type, a business, a category and a state or city.
 * Never who did it, their address or device, or the words they typed.
 */

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|pingdom|curl|wget|python-requests/i;

/** Link previews, crawlers and monitors would inflate the numbers, so they are not counted. */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_PATTERN.test(userAgent);
}

/** A share as a whole-number-ish percentage ("42%", "3.5%"), or "–" when there is nothing to divide by. */
export function rate(part: number, whole: number): string {
  if (!whole) return "–";
  const value = (part / whole) * 100;
  const rounded = value >= 10 || value === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${Math.min(rounded, 100)}%`;
}

export const ANALYTICS_PERIODS = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
  "12m": { label: "Last 12 months", days: 365 },
} as const;
export type AnalyticsPeriod = keyof typeof ANALYTICS_PERIODS;

export function parsePeriod(value: unknown, fallback: AnalyticsPeriod = "30d"): AnalyticsPeriod {
  return typeof value === "string" && value in ANALYTICS_PERIODS ? (value as AnalyticsPeriod) : fallback;
}

export type DailyPoint = { day: string; searches: number; booking_requests: number };

/** Daily points grouped into at most `buckets` bars (weeks or months for long periods). */
export function bucketDaily(points: DailyPoint[], buckets = 14): (DailyPoint & { label: string })[] {
  if (points.length === 0) return [];
  const size = Math.max(1, Math.ceil(points.length / buckets));
  const out: (DailyPoint & { label: string })[] = [];
  for (let i = 0; i < points.length; i += size) {
    const group = points.slice(i, i + size);
    const first = group[0]!.day;
    const last = group.at(-1)!.day;
    out.push({
      day: first,
      label: first === last ? first : `${first} – ${last}`,
      searches: group.reduce((sum, p) => sum + p.searches, 0),
      booking_requests: group.reduce((sum, p) => sum + p.booking_requests, 0),
    });
  }
  return out;
}
