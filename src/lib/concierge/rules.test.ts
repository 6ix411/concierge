import { describe, expect, it } from "vitest";

import { composeResults } from "./compose";
import { extractAmounts } from "./guard";
import { mergeRequests, runRules } from "./rules";
import { fakeData, frames, ids, lens, snapshot } from "./test-fixtures";
import { NO_PROVIDER_MESSAGE } from "./types";

const now = new Date("2026-10-01T11:00:00Z");
const example =
  "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k.";

describe("runRules", () => {
  it("answers the example from the database", async () => {
    const data = fakeData();
    const { draft, facts } = await runRules({ data, history: [], message: example, now });
    expect(data.calls[0]).toMatchObject({
      category: "photography-video",
      location: "Victoria Island",
      date: "2026-10-10",
      guests: 100,
      budgetMinor: 30_000_000,
    });
    expect(draft.providerIds).toEqual([ids.snapshot, ids.frames, ids.lens]);
    expect(draft.message).toContain(
      "I found one verified provider on Concierge that fits: Snapshot Studios.",
    );
    expect(draft.message).toContain("close options");
    expect(facts.lastRequirements?.event).toBe("Birthday");
  });

  it("asks where when the location is missing, then searches with the answer", async () => {
    const data = fakeData();
    const first = await runRules({ data, history: [], message: "I need a photographer", now });
    expect(first.draft.message).toMatch(/^Where do you need it/);
    expect(data.calls).toHaveLength(0);

    const second = await runRules({
      data,
      history: [
        { role: "user", content: "I need a photographer" },
        { role: "assistant", content: first.draft.message },
      ],
      message: "Lekki",
      now,
    });
    expect(data.calls[0]).toMatchObject({ category: "photography-video", location: "Lekki" });
    expect(second.draft.providerIds.length).toBeGreaterThan(0);
  });

  it("greets and asks what's needed", async () => {
    const { draft } = await runRules({ data: fakeData(), history: [], message: "Hello!", now });
    expect(draft.message).toMatch(/^Hello! What service do you need/);
    expect(draft.suggestions.length).toBeGreaterThan(0);
  });

  it("uses the platform's exact words when nothing is registered", async () => {
    const { draft } = await runRules({ data: fakeData([]), history: [], message: "caterer in Ikeja", now });
    expect(draft.message).toBe(NO_PROVIDER_MESSAGE);
    expect(draft.providerIds).toEqual([]);
  });

  it("compares the providers it showed last", async () => {
    const { draft } = await runRules({
      data: fakeData(),
      history: [
        { role: "user", content: example },
        { role: "assistant", content: "…", providerIds: [ids.snapshot, ids.frames, ids.lens] },
      ],
      message: "Compare the top 3",
      now,
    });
    expect(draft.compare).toBe(true);
    expect(draft.providerIds).toEqual([ids.snapshot, ids.frames, ids.lens]);
  });
});

describe("mergeRequests", () => {
  it("lets later messages fill in and override details", () => {
    const request = mergeRequests(
      ["photographer in Lekki for 50 guests", "actually Ikoyi, next Saturday"],
      now,
    );
    expect(request).toMatchObject({
      category: { slug: "photography-video" },
      location: { label: "Ikoyi" },
      date: "2026-10-10",
      guests: 50,
    });
  });
});

describe("composeResults", () => {
  it("says so plainly when only close options exist", () => {
    const draft = composeResults([frames, lens], null);
    expect(draft.message.startsWith(NO_PROVIDER_MESSAGE)).toBe(true);
    expect(draft.providerIds).toEqual([ids.frames, ids.lens]);
  });

  it("explains the best match from its real details", () => {
    const draft = composeResults([snapshot], {
      query: null,
      category: null,
      event: null,
      location: "Victoria Island",
      date: "2026-10-10",
      time: null,
      guests: 100,
      budgetMinor: 30_000_000,
    });
    expect(draft.message).toContain("serves Victoria Island");
    expect(draft.message).toContain("available Sat, 10 Oct");
    expect(draft.message).toContain("₦250k, within your ₦300k budget");
  });
});

describe("extractAmounts", () => {
  it.each([
    ["₦250,000", [25_000_000]],
    ["₦1.5m and N300k", [150_000_000, 30_000_000]],
    ["300,000 naira", [30_000_000]],
    ["150 guests on 10 Oct", []],
  ])("%s", (text, expected) => {
    expect(extractAmounts(text)).toEqual(expected);
  });
});
