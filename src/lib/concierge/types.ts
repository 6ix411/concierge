import type { Reason } from "@/lib/matching/explain";
import type { Match } from "@/lib/matching/types";

export type Recommendation = Match & { reasons: Reason[] };

/** What the customer has asked for, as last searched. */
export type Requirements = {
  query: string | null;
  category: { slug: string; label: string } | null;
  event: string | null;
  /** The place as the customer named it ("Victoria Island", "Lekki"). */
  location: string | null;
  /** YYYY-MM-DD, Lagos time. */
  date: string | null;
  /** HH:MM. */
  time: string | null;
  guests: number | null;
  budgetMinor: number | null;
};

/** A turn of the conversation as the model sees it. Assistant turns carry the providers they showed. */
export type ChatTurn = { role: "user" | "assistant"; content: string; providerIds?: string[] };

/** What the concierge decided to say, before it is checked against the database. */
export type ReplyDraft = {
  message: string;
  /** Providers to show as cards, best first. */
  providerIds: string[];
  /** Show the providers side by side. */
  compare: boolean;
  /** Offer to start a booking (the customer completes it themselves). */
  booking: { providerId: string; serviceIds: string[]; date: string | null } | null;
  /** Quick replies the customer can tap. */
  suggestions: string[];
};

export type BookingLink = { href: string; businessName: string; services: string[]; date: string | null };

/** The reply the customer sees. Every provider, price and availability comes from the database. */
export type ConciergeReply = {
  message: string;
  providers: Recommendation[];
  compare: boolean;
  booking: BookingLink | null;
  suggestions: string[];
  understood: { label: string; value: string }[];
  /** "ai" when Claude wrote the message, "rules" for the built-in concierge. */
  source: "ai" | "rules";
};

/** The exact words the platform uses when nobody on Concierge fits. */
export const NO_PROVIDER_MESSAGE =
  "No suitable registered provider is currently available for your requirements.";
