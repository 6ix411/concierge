import type { Database } from "@/types/database";

type Row = Database["public"]["Functions"]["match_businesses"]["Returns"][number];

/** One business returned by the matching engine, with the columns that can be empty typed as such. */
export type Match = Omit<
  Row,
  | "description"
  | "logo_path"
  | "cover_path"
  | "city"
  | "category_name"
  | "min_price_minor"
  | "max_price_minor"
  | "location_match"
  | "availability"
  | "availability_note"
  | "within_budget"
  | "guest_capacity"
  | "fits_guests"
> & {
  description: string | null;
  logo_path: string | null;
  cover_path: string | null;
  city: string | null;
  category_name: string | null;
  min_price_minor: number | null;
  /** Top of the price range across the same services; equals min_price_minor when there's one price. */
  max_price_minor: number | null;
  /** How well it covers the place asked for; null when no place was given. */
  location_match: "area" | "city" | "state" | "nearby" | null;
  availability: "available" | "unavailable" | "unknown";
  availability_note: string | null;
  within_budget: boolean | null;
  guest_capacity: number | null;
  fits_guests: boolean | null;
};

export type MatchSort = "match" | "rating" | "price_low" | "price_high";
