/**
 * Reads a customer's plain-language request and pulls out what the platform can search on.
 * Deterministic and dependency-free, so the concierge works without an AI key; the AI stage
 * can replace or enrich this with a model while keeping the same output shape.
 */

export type ConciergeIntent = {
  query: string;
  categorySlug: string | null;
  categoryLabel: string | null;
  location: string | null;
  budgetMinor: number | null;
  guests: number | null;
  /** The words used for text matching, with location and numbers removed. */
  keywords: string;
};

/** Areas and cities customers commonly name. Longer names first so "Victoria Island" beats "Island". */
export const knownLocations = [
  "Victoria Island",
  "Lekki Phase 1",
  "Banana Island",
  "Ikoyi",
  "Lekki",
  "Ajah",
  "Ikeja",
  "Yaba",
  "Surulere",
  "Maryland",
  "Gbagada",
  "Magodo",
  "Festac",
  "Apapa",
  "Oshodi",
  "Ikorodu",
  "Epe",
  "Maitama",
  "Wuse",
  "Garki",
  "Asokoro",
  "Gwarinpa",
  "Lagos",
  "Abuja",
  "Port Harcourt",
  "Ibadan",
  "Enugu",
  "Kano",
  "Benin",
];

const aliases: Record<string, string> = { vi: "Victoria Island", ph: "Port Harcourt", fct: "Abuja" };

/** Words that point to a category (matched on word starts, so "decorator" hits "decor"). */
const categoryKeywords: { slug: string; label: string; words: string[] }[] = [
  {
    slug: "event-decoration",
    label: "Event decoration",
    words: ["decor", "decorat", "styling", "backdrop", "florist"],
  },
  { slug: "catering", label: "Catering", words: ["cater", "chef", "food", "small chops", "jollof", "cook"] },
  {
    slug: "photography-video",
    label: "Photography & video",
    words: ["photograph", "videograph", "photo", "video", "drone"],
  },
  {
    slug: "makeup-hair",
    label: "Makeup & hair",
    words: ["makeup", "make-up", "mua", "gele", "hair", "bridal glam"],
  },
  { slug: "cleaning", label: "Cleaning", words: ["clean", "fumigat", "janitor"] },
  {
    slug: "plumbing",
    label: "Plumbing",
    words: ["plumb", "leak", "pipe", "drain", "water heater", "toilet"],
  },
  { slug: "moving", label: "Moving", words: ["mover", "moving", "relocat", "haulage", "truck"] },
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseAmount(raw: string, suffix: string | undefined): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = suffix?.toLowerCase();
  const multiplier = unit === "m" || unit === "million" ? 1_000_000 : unit === "k" ? 1_000 : 1;
  return Math.round(value * multiplier * 100); // kobo
}

export function parseIntent(input: string): ConciergeIntent {
  const query = input.trim().slice(0, 500);
  let rest = ` ${query} `;

  // Budget: "₦1.5m", "N500k", "1,500,000 naira", "budget of 2m", "under 300k".
  let budgetMinor: number | null = null;
  const budgetPatterns = [
    /(?:₦|\bN|\bNGN\s?)\s?([\d.,]+)\s?(m|million|k)?\b/i,
    /\b([\d.,]+)\s?(m|million|k)?\s?(?:naira|ngn)\b/i,
    /\b(?:budget|under|below|max(?:imum)?|up to)\s(?:of\s)?(?:₦|N)?\s?([\d.,]+)\s?(m|million|k)?\b/i,
    /\b([\d.]+)\s?(m|million|k)\b(?!\s*guests?)/i,
  ];
  for (const pattern of budgetPatterns) {
    const match = rest.match(pattern);
    if (match?.[1]) {
      budgetMinor = parseAmount(match[1], match[2]);
      if (budgetMinor !== null) {
        rest = rest.replace(match[0], " ");
        break;
      }
    }
  }

  // Guests: "300 guests", "for 150 people", "200 pax".
  let guests: number | null = null;
  const guestMatch = rest.match(/\b(\d{1,5})\s?(?:guests?|people|persons|pax|attendees)\b/i);
  if (guestMatch?.[1]) {
    guests = Number.parseInt(guestMatch[1], 10);
    rest = rest.replace(guestMatch[0], " ");
  }

  // Location.
  let location: string | null = null;
  for (const place of knownLocations) {
    const pattern = new RegExp(`\\b${escape(place)}\\b`, "i");
    if (pattern.test(rest)) {
      location = place === "Lekki Phase 1" ? "Lekki" : place;
      rest = rest.replace(pattern, " ");
      break;
    }
  }
  if (!location) {
    for (const [alias, place] of Object.entries(aliases)) {
      const pattern = new RegExp(`\\bin\\s+${alias}\\b`, "i");
      if (pattern.test(rest)) {
        location = place;
        rest = rest.replace(pattern, " ");
        break;
      }
    }
  }

  // Category.
  const lower = rest.toLowerCase();
  const category =
    categoryKeywords.find(({ words }) =>
      words.some((word) => new RegExp(`\\b${escape(word)}`).test(lower)),
    ) ?? null;

  const keywords = rest
    .replace(
      /\b(i|we|need|want|looking|for|a|an|the|in|at|on|with|my|our|of|and|to|some|someone|who|can|please|budget)\b/gi,
      " ",
    )
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    query,
    categorySlug: category?.slug ?? null,
    categoryLabel: category?.label ?? null,
    location,
    budgetMinor,
    guests,
    keywords,
  };
}
