/** Shared test data for the concierge tests. Not used by the app. */

import type Anthropic from "@anthropic-ai/sdk";

import type { Match } from "@/lib/matching/types";

import type { ModelClient } from "./agent";
import type { DataSource } from "./tools";

export const ids = {
  snapshot: "c0000000-0000-0000-0000-000000000010",
  frames: "c0000000-0000-0000-0000-000000000011",
  lens: "c0000000-0000-0000-0000-000000000007",
  birthdayService: "d0000000-0000-0000-0000-000000000101",
};

export function match(overrides: Partial<Match> & Pick<Match, "id" | "name">): Match {
  return {
    slug: overrides.name.toLowerCase().replace(/[^a-z]+/g, "-"),
    description: null,
    logo_path: null,
    cover_path: null,
    city: "Lagos",
    state: "Lagos",
    is_verified: true,
    rating_avg: 0,
    rating_count: 0,
    category_name: "Photography & video",
    min_price_minor: null,
    max_price_minor: null,
    has_quote_only: false,
    matched_services: [],
    served_areas: [],
    completed_bookings: 0,
    location_match: null,
    availability: "unknown",
    availability_note: null,
    within_budget: null,
    guest_capacity: null,
    fits_guests: null,
    score: 50,
    score_parts: {},
    ...overrides,
  };
}

export const snapshot = match({
  id: ids.snapshot,
  name: "Snapshot Studios",
  slug: "snapshot-studios",
  min_price_minor: 25_000_000,
  matched_services: ["Birthday & Party Coverage (up to 150 guests)"],
  served_areas: ["Victoria Island", "Ikoyi", "Lekki"],
  location_match: "area",
  availability: "available",
  within_budget: true,
  guest_capacity: 150,
  fits_guests: true,
  score: 93,
});

export const frames = match({
  id: ids.frames,
  name: "Frames by Kemi",
  slug: "frames-by-kemi",
  min_price_minor: 15_000_000,
  matched_services: ["Birthday Shoot (up to 60 guests)"],
  location_match: "area",
  availability: "unavailable",
  availability_note: "Not working that day",
  within_budget: true,
  guest_capacity: 60,
  fits_guests: false,
  score: 68,
});

export const lens = match({
  id: ids.lens,
  name: "Lens & Light Photography",
  slug: "lens-and-light",
  min_price_minor: 60_000_000,
  rating_avg: 5,
  rating_count: 1,
  location_match: "nearby",
  availability: "available",
  within_budget: false,
  score: 48,
});

/** A data source over a fixed list of providers, filtered roughly like the database. */
export function fakeData(providers: Match[] = [snapshot, frames, lens]): DataSource & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    today: "2026-10-01",
    categories: [
      { slug: "photography-video", label: "Photography & video" },
      { slug: "catering", label: "Catering" },
    ],
    async findMatches(filters) {
      calls.push(filters);
      if (filters.ids) return providers.filter((p) => filters.ids!.includes(p.id));
      if (filters.category && filters.category !== "photography-video") return [];
      return providers;
    },
    async getDetails(providerId) {
      if (providerId !== ids.snapshot) return null;
      return {
        description: "Event photography across Lagos.",
        min_notice_hours: 24,
        booking_window_days: 180,
        services: [
          {
            id: ids.birthdayService,
            name: "Birthday & Party Coverage (up to 150 guests)",
            description: null,
            pricing_type: "fixed",
            price_minor: 25_000_000,
            duration_minutes: 360,
            is_addon: false,
            package_includes: [],
          },
        ],
        areas: [{ state: "Lagos", city: "Lagos", area: "Victoria Island" }],
        weekly_hours: [{ day_of_week: 6, start_time: "09:00:00", end_time: "22:00:00" }],
        reviews: [],
      };
    },
  };
}

type Step =
  | Anthropic.Messages.ContentBlock[]
  | ((params: Anthropic.Messages.MessageCreateParamsNonStreaming) => Anthropic.Messages.ContentBlock[]);

let useCounter = 0;
export const toolUse = (name: string, input: unknown): Anthropic.Messages.ContentBlock =>
  ({ type: "tool_use", id: `toolu_${++useCounter}`, name, input }) as Anthropic.Messages.ContentBlock;

/** A model that plays back a script, one step per call, and records what it was sent. */
export function scriptedClient(
  steps: Step[],
): ModelClient & { requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] } {
  const requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  return {
    requests,
    messages: {
      async create(params) {
        requests.push(structuredClone(params));
        const step = steps[Math.min(requests.length - 1, steps.length - 1)]!;
        const content = typeof step === "function" ? step(params) : step;
        return {
          id: `msg_${requests.length}`,
          type: "message",
          role: "assistant",
          model: params.model,
          content,
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as Anthropic.Messages.Message;
      },
    },
  };
}
