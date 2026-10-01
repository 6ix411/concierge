import { lagosToday } from "@/lib/dates";

import type { SearchParams } from "./queries";

export const sortOptions = [
  { value: "relevance", label: "Best match" },
  { value: "rating", label: "Highest rated" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
] as const;

type Raw = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

export const PAGE_SIZE = 12;

/** "2026-02-31" looks like a date but isn't one. */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Reads search filters from the URL. Budget is entered in naira and converted to kobo. */
export function parseSearchParams(
  raw: Raw,
  now: Date = new Date(),
): Required<Pick<SearchParams, "sort">> & SearchParams & { page: number; maxNaira?: string } {
  const sortValue = first(raw.sort);
  const sort = sortOptions.some((option) => option.value === sortValue)
    ? (sortValue as NonNullable<SearchParams["sort"]>)
    : "relevance";
  const maxNaira = first(raw.max)?.replace(/[^\d]/g, "").slice(0, 12);
  const page = Math.max(1, Math.min(50, Number.parseInt(first(raw.page) ?? "1", 10) || 1));
  const dateValue = first(raw.date);
  const date = dateValue && isRealDate(dateValue) && dateValue >= lagosToday(now) ? dateValue : null;
  const guestCount = Number.parseInt(first(raw.guests) ?? "", 10);
  return {
    query: first(raw.q)?.slice(0, 200),
    category: first(raw.category),
    location: first(raw.location)?.slice(0, 80),
    date,
    guests: guestCount > 0 ? Math.min(guestCount, 100_000) : null,
    maxPriceMinor: maxNaira ? Number(maxNaira) * 100 : null,
    maxNaira,
    sort,
    page,
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  };
}
