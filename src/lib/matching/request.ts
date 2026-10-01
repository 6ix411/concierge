/**
 * Turns a customer's plain-language request into structured details the matching engine searches on:
 *
 *   "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k."
 *   → category Photography & video, event Birthday, location Victoria Island (Lagos),
 *     date the Saturday of next week, 100 guests, budget ₦300,000.
 *
 * Deterministic and dependency-free, so search works without an AI key. The AI stage can replace or
 * enrich this with a model while keeping the same output shape.
 */

import { addDays, lagosToday } from "@/lib/dates";

export type Place = { area: string | null; city: string | null; state: string; label: string };

export type ServiceRequest = {
  query: string;
  category: { slug: string; label: string } | null;
  event: { key: string; label: string } | null;
  location: Place | null;
  /** YYYY-MM-DD, in Lagos time. */
  date: string | null;
  /** HH:MM, 24-hour. */
  time: string | null;
  guests: number | null;
  budgetMinor: number | null;
  /** Words left for text matching, with places, dates and numbers removed. */
  keywords: string;
};

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/** Areas and cities customers name, with where they are. Longer names first so "Victoria Island" beats "Island". */
const places: { name: string; area?: string; city: string | null; state: string }[] = [
  { name: "Victoria Island", city: "Lagos", state: "Lagos" },
  { name: "Lekki Phase 1", area: "Lekki", city: "Lagos", state: "Lagos" },
  { name: "Banana Island", city: "Lagos", state: "Lagos" },
  { name: "Ikoyi", city: "Lagos", state: "Lagos" },
  { name: "Lekki", city: "Lagos", state: "Lagos" },
  { name: "Ajah", city: "Lagos", state: "Lagos" },
  { name: "Ikeja", city: "Lagos", state: "Lagos" },
  { name: "Yaba", city: "Lagos", state: "Lagos" },
  { name: "Surulere", city: "Lagos", state: "Lagos" },
  { name: "Maryland", city: "Lagos", state: "Lagos" },
  { name: "Gbagada", city: "Lagos", state: "Lagos" },
  { name: "Magodo", city: "Lagos", state: "Lagos" },
  { name: "Festac", city: "Lagos", state: "Lagos" },
  { name: "Apapa", city: "Lagos", state: "Lagos" },
  { name: "Oshodi", city: "Lagos", state: "Lagos" },
  { name: "Ikorodu", city: "Lagos", state: "Lagos" },
  { name: "Epe", city: "Lagos", state: "Lagos" },
  { name: "Maitama", city: "Abuja", state: "FCT" },
  { name: "Wuse", city: "Abuja", state: "FCT" },
  { name: "Garki", city: "Abuja", state: "FCT" },
  { name: "Asokoro", city: "Abuja", state: "FCT" },
  { name: "Gwarinpa", city: "Abuja", state: "FCT" },
  { name: "Lagos", city: "Lagos", state: "Lagos" },
  { name: "Abuja", city: "Abuja", state: "FCT" },
  { name: "Port Harcourt", city: "Port Harcourt", state: "Rivers" },
  { name: "Ibadan", city: "Ibadan", state: "Oyo" },
  { name: "Enugu", city: "Enugu", state: "Enugu" },
  { name: "Kano", city: "Kano", state: "Kano" },
  { name: "Benin", city: "Benin City", state: "Edo" },
];

const placeAliases: Record<string, string> = { vi: "Victoria Island", ph: "Port Harcourt", fct: "Abuja" };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toPlace(entry: (typeof places)[number]): Place {
  const isCity = entry.name === entry.city || entry.name === "Benin";
  const area = isCity ? null : (entry.area ?? entry.name);
  return { area, city: entry.city, state: entry.state, label: area ?? entry.city ?? entry.state };
}

/** Resolves a place someone typed ("vi", "Lekki", "Abuja") to an area, city and state. */
export function resolvePlace(text: string): Place | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const alias = placeAliases[value];
  const entry = places.find((p) => p.name.toLowerCase() === (alias ?? value).toLowerCase());
  return entry ? toPlace(entry) : null;
}

// ---------------------------------------------------------------------------
// Categories and events
// ---------------------------------------------------------------------------

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
    words: ["photograph", "videograph", "photo", "video", "drone", "pictures", "shoot"],
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

const events: { key: string; label: string; words: string[] }[] = [
  { key: "wedding", label: "Wedding", words: ["wedding", "bride", "bridal", "reception"] },
  {
    key: "traditional_wedding",
    label: "Traditional wedding",
    words: ["traditional wedding", "trad wedding", "introduction", "engagement"],
  },
  { key: "birthday", label: "Birthday", words: ["birthday", "bday", "b-day", "turning \\d+"] },
  {
    key: "naming",
    label: "Naming ceremony",
    words: ["naming ceremony", "naming", "christening", "dedication"],
  },
  { key: "funeral", label: "Funeral", words: ["funeral", "burial", "memorial", "wake keep"] },
  {
    key: "corporate",
    label: "Corporate event",
    words: ["corporate", "conference", "launch", "office party", "end of year party", "agm"],
  },
  { key: "graduation", label: "Graduation", words: ["graduation", "convocation"] },
  { key: "anniversary", label: "Anniversary", words: ["anniversary"] },
  { key: "baby_shower", label: "Baby shower", words: ["baby shower", "gender reveal"] },
  { key: "party", label: "Party", words: ["owambe", "party", "celebration", "get together", "get-together"] },
];

// ---------------------------------------------------------------------------
// Money, guests, dates and times
// ---------------------------------------------------------------------------

function parseAmount(raw: string, suffix: string | undefined): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = suffix?.toLowerCase();
  const multiplier = unit === "m" || unit === "million" ? 1_000_000 : unit === "k" ? 1_000 : 1;
  return Math.round(value * multiplier * 100); // kobo
}

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const weekdayPattern = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?";
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthPattern =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function weekdayIndex(word: string): number {
  return weekdays.findIndex((day) => day.startsWith(word.toLowerCase().slice(0, 3)));
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The next given weekday after today (not today itself). */
function upcoming(today: string, target: number): string {
  const diff = (target - dayOfWeek(today) + 7) % 7 || 7;
  return addDays(today, diff);
}

/** A day and month with no year means the next time that date comes round. */
function nextDate(today: string, day: number, monthIndex: number): string | null {
  if (day < 1 || day > 31 || monthIndex < 0 || monthIndex > 11) return null;
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const candidate = `${y}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const check = new Date(`${candidate}T12:00:00Z`);
    if (check.getUTCDate() !== day) return null; // e.g. 31 June
    if (candidate >= today) return candidate;
  }
  return null;
}

type Found = { value: string; match: string };

/**
 * Reads the date of the job. "This Saturday" is the coming Saturday; "next Saturday" is the Saturday
 * of next week (weeks start on Monday), which is how most people in Nigeria mean it.
 */
export function findDate(text: string, today: string): Found | null {
  const lower = text.toLowerCase();
  const rules: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => `${m[1]}-${m[2]}-${m[3]}`],
    [
      /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/,
      (m) => {
        const day = Number(m[1]);
        const month = Number(m[2]) - 1;
        if (!m[3]) return nextDate(today, day, month);
        const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        return new Date(`${date}T12:00:00Z`).getUTCDate() === day ? date : null;
      },
    ],
    [
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthPattern}\\b`),
      (m) => nextDate(today, Number(m[1]), months.indexOf(m[2]!.slice(0, 3))),
    ],
    [
      new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`),
      (m) => nextDate(today, Number(m[2]), months.indexOf(m[1]!.slice(0, 3))),
    ],
    [/\b(today|tonight)\b/, () => today],
    [/\b(tomorrow|tmrw|tmr)\b/, () => addDays(today, 1)],
    [/\bthis weekend\b/, () => (dayOfWeek(today) === 6 ? today : upcoming(today, 6))],
    [/\bnext weekend\b/, () => addDays(upcoming(today, 6), dayOfWeek(today) === 0 ? 0 : 7)],
    [
      new RegExp(`\\bnext\\s+${weekdayPattern}\\b`),
      (m) => {
        const target = weekdayIndex(m[1]!);
        // Monday of next week, then that weekday within it.
        const daysToNextMonday = (8 - dayOfWeek(today)) % 7 || 7;
        const nextMonday = addDays(today, daysToNextMonday);
        return addDays(nextMonday, (target + 6) % 7);
      },
    ],
    [
      new RegExp(`\\b(?:this|on|coming)?\\s*${weekdayPattern}\\b`),
      (m) => {
        const target = weekdayIndex(m[1]!);
        return target === dayOfWeek(today) && /\bthis\b/.test(m[0]) ? today : upcoming(today, target);
      },
    ],
  ];
  for (const [pattern, resolve] of rules) {
    const match = lower.match(pattern);
    if (!match) continue;
    const value = resolve(match);
    if (value) return { value, match: match[0] };
  }
  return null;
}

/** "at 2pm", "2:30 pm", "by 14:00", "in the evening" → HH:MM. */
export function findTime(text: string): Found | null {
  const lower = text.toLowerCase();
  const twelve = lower.match(/\b(?:at|by|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (twelve) {
    let hours = Number(twelve[1]) % 12;
    if (twelve[3] === "pm") hours += 12;
    const minutes = Number(twelve[2] ?? 0);
    if (hours < 24 && minutes < 60)
      return {
        value: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
        match: twelve[0],
      };
  }
  const twentyFour = lower.match(/\b(?:at|by|from)\s+([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFour)
    return { value: `${twentyFour[1]!.padStart(2, "0")}:${twentyFour[2]}`, match: twentyFour[0] };
  const parts: [RegExp, string][] = [
    [/\bin the morning\b/, "09:00"],
    [/\bin the afternoon\b/, "13:00"],
    [/\bin the evening\b/, "18:00"],
  ];
  for (const [pattern, value] of parts) {
    const match = lower.match(pattern);
    if (match) return { value, match: match[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search words
// ---------------------------------------------------------------------------

/** Words that appear in almost any request and would match almost any business. */
const genericWords = new Set(
  "service services servicing someone somebody anyone person provider providers company business vendor help fix fixing get find good best great cheap affordable reliable professional urgent urgently asap near me my you your need needs want looking please hire book booking".split(
    " ",
  ),
);

/** Drops generic words so "someone to service my generator" searches for "generator". */
export function meaningfulQuery(text: string | null | undefined): string | null {
  const words = (text ?? "")
    .split(/\s+/)
    .filter((word) => word && !genericWords.has(word.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "")));
  return words.join(" ").trim() || null;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export function parseServiceRequest(input: string, now: Date = new Date()): ServiceRequest {
  const query = input.trim().slice(0, 500);
  const today = lagosToday(now);
  let rest = ` ${query} `;
  const remove = (fragment: string) => {
    rest = rest.replace(new RegExp(escape(fragment), "i"), " ");
  };

  // Budget: "₦1.5m", "N500k", "1,500,000 naira", "budget of 2m", "under 300k".
  let budgetMinor: number | null = null;
  const budgetPatterns = [
    /(?:₦|\bN|\bNGN\s?)\s?([\d.,]+)\s?(m|million|k)?\b/i,
    /\b([\d.,]+)\s?(m|million|k)?\s?(?:naira|ngn)\b/i,
    /\b(?:budget|under|below|max(?:imum)?|up to)\s(?:is\s|of\s)?(?:about\s|around\s)?(?:₦|N)?\s?([\d.,]+)\s?(m|million|k)?\b/i,
    /\b([\d.]+)\s?(m|million|k)\b(?!\s*guests?)/i,
  ];
  for (const pattern of budgetPatterns) {
    const match = rest.match(pattern);
    if (match?.[1]) {
      budgetMinor = parseAmount(match[1], match[2]);
      if (budgetMinor !== null) {
        remove(match[0]);
        break;
      }
    }
  }

  // Guests: "300 guests", "for 150 people", "about 100 people", "200 pax".
  let guests: number | null = null;
  const guestMatch = rest.match(
    /\b(?:about|around|roughly|approx(?:imately)?|up to|over)?\s*(\d{1,5})\s?(?:guests?|people|persons|pax|attendees)\b/i,
  );
  if (guestMatch?.[1]) {
    guests = Number.parseInt(guestMatch[1], 10);
    remove(guestMatch[0]);
  }

  // Time before date, so "10/10 at 2pm" keeps both.
  const time = findTime(rest);
  if (time) remove(time.match);
  const date = findDate(rest, today);
  if (date) remove(date.match);

  // Location.
  let location: Place | null = null;
  for (const entry of places) {
    const pattern = new RegExp(`\\b${escape(entry.name)}\\b`, "i");
    if (pattern.test(rest)) {
      location = toPlace(entry);
      rest = rest.replace(pattern, " ");
      break;
    }
  }
  if (!location) {
    for (const [alias, name] of Object.entries(placeAliases)) {
      const pattern = new RegExp(`\\bin\\s+${alias}\\b`, "i");
      if (pattern.test(rest)) {
        location = resolvePlace(name);
        rest = rest.replace(pattern, " ");
        break;
      }
    }
  }

  // Category and event (an event word stays in the keywords: it helps match services).
  const lower = rest.toLowerCase();
  const category =
    categoryKeywords.find(({ words }) =>
      words.some((word) => new RegExp(`\\b${escape(word)}`).test(lower)),
    ) ?? null;
  const event =
    events.find(({ words }) => words.some((word) => new RegExp(`\\b${word}\\b`).test(lower))) ?? null;

  const keywords = rest
    .replace(
      /\b(i|we|im|i'm|need|needs|want|looking|for|a|an|the|in|at|on|with|my|our|of|and|to|some|someone|who|can|please|budget|about|around|is|it|its|this|that|will|be|by|from)\b/gi,
      " ",
    )
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const searchWords = meaningfulQuery(keywords) ?? "";

  return {
    query,
    category: category ? { slug: category.slug, label: category.label } : null,
    event: event ? { key: event.key, label: event.label } : null,
    location,
    date: date && date.value >= today ? date.value : null,
    time: time?.value ?? null,
    guests,
    budgetMinor,
    keywords: searchWords,
  };
}
