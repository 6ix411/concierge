const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

/** ₦1,500,000 from 150000000 kobo. */
export function formatNaira(amountMinor: number | bigint): string {
  return naira.format(Number(amountMinor) / 100);
}

/** Short form for tight spaces: ₦1.5m, ₦450k, ₦8,000. */
export function formatNairaShort(amountMinor: number): string {
  const naira = amountMinor / 100;
  if (naira >= 1_000_000) return `₦${trim(naira / 1_000_000)}m`;
  if (naira >= 100_000) return `₦${trim(naira / 1_000)}k`;
  return formatNaira(amountMinor);
}

function trim(value: number): string {
  return value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, "");
}

const dateTime = new Intl.DateTimeFormat("en-NG", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Africa/Lagos",
});
const dateOnly = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Lagos",
});

export function formatDateTime(value: string | Date): string {
  return dateTime.format(new Date(value));
}

export function formatDate(value: string | Date): string {
  return dateOnly.format(new Date(value));
}

export const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "08:00:00" → "8:00 AM". */
export function formatTime(value: string): string {
  const [h = 0, m = 0] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
