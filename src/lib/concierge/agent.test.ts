import { describe, expect, it } from "vitest";

import { runAgent, systemPrompt } from "./agent";
import { fakeData, ids, scriptedClient, toolUse } from "./test-fixtures";
import { NO_PROVIDER_MESSAGE } from "./types";

const example =
  "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k.";

const search = toolUse("search_providers", {
  service_query: "birthday photographer",
  category: "photography-video",
  event: "Birthday",
  location: "Victoria Island",
  date: "2026-10-10",
  guests: 100,
  budget_naira: 300000,
});

function run(steps: Parameters<typeof scriptedClient>[0], knownBusinessNames: string[] = []) {
  const client = scriptedClient(steps);
  const data = fakeData();
  return {
    client,
    data,
    result: runAgent({
      client,
      model: "test-model",
      data,
      history: [],
      message: example,
      knownBusinessNames,
    }),
  };
}

describe("runAgent", () => {
  it("searches the platform and recommends what it returned", async () => {
    const { client, data, result } = run([
      [search],
      [
        toolUse("reply_to_customer", {
          message:
            "Snapshot Studios is the best fit: they cover Victoria Island, are free that Saturday and their birthday coverage is ₦250,000, within your ₦300k budget.",
          provider_ids: [ids.snapshot, ids.frames],
          suggested_replies: ["Compare them", "Book Snapshot Studios"],
        }),
      ],
    ]);
    const { draft, facts, verified } = await result;

    expect(verified).toBe(true);
    expect(draft.providerIds).toEqual([ids.snapshot, ids.frames]);
    expect(draft.suggestions).toHaveLength(2);
    expect(facts.lastRequirements).toMatchObject({
      category: { slug: "photography-video" },
      location: "Victoria Island",
      date: "2026-10-10",
      guests: 100,
      budgetMinor: 30_000_000,
    });
    expect(data.calls[0]).toMatchObject({
      category: "photography-video",
      location: "Victoria Island",
      guests: 100,
    });
    // The search results went back to the model as tool results.
    expect(JSON.stringify(client.requests[1]!.messages.at(-1))).toContain("Snapshot Studios");
  });

  it("rejects providers no tool returned, then accepts the corrected reply", async () => {
    const invented = "c0000000-0000-0000-0000-0000000000ff";
    const { client, result } = run([
      [search],
      [toolUse("reply_to_customer", { message: "Try Star Photos.", provider_ids: [invented] })],
      [
        toolUse("reply_to_customer", {
          message: "Snapshot Studios fits best.",
          provider_ids: [ids.snapshot],
        }),
      ],
    ]);
    const { draft, verified } = await result;

    expect(verified).toBe(true);
    expect(draft.providerIds).toEqual([ids.snapshot]);
    const feedback = JSON.stringify(client.requests[2]!.messages.at(-1));
    expect(feedback).toContain("is_error");
    expect(feedback).toContain(invented);
  });

  it("never lets an invented price through, even when the model insists", async () => {
    const lie = toolUse("reply_to_customer", {
      message: "Snapshot Studios can do it for ₦180,000.",
      provider_ids: [ids.snapshot],
    });
    const { client, result } = run([[search], [lie], [lie], [lie], [lie]]);
    const { draft, verified } = await result;

    expect(verified).toBe(false);
    expect(draft.message).not.toContain("180");
    expect(draft.message).toContain("Snapshot Studios");
    // Built from the database: the full match first, then the close options.
    expect(draft.providerIds[0]).toBe(ids.snapshot);
    expect(client.requests.length).toBeLessThanOrEqual(5);
  });

  it.each([
    ["I've booked Snapshot Studios for you.", "can't book"],
    ["Your booking has been confirmed with Snapshot Studios.", "can't book"],
    ["Payment was successful, see you Saturday!", "can't book"],
    ["I also found some photographers on Google.", "internet"],
    ["Snapshot Studios is rated 4.9 stars.", "rating"],
  ])("rejects %s", async (message, problem) => {
    const { client, result } = run([
      [search],
      [toolUse("reply_to_customer", { message, provider_ids: [ids.snapshot] })],
      [
        toolUse("reply_to_customer", {
          message: "Snapshot Studios fits best.",
          provider_ids: [ids.snapshot],
        }),
      ],
    ]);
    const { draft } = await result;
    expect(draft.message).toBe("Snapshot Studios fits best.");
    expect(JSON.stringify(client.requests[2]!.messages.at(-1)).toLowerCase()).toContain(problem);
  });

  it("rejects naming a business the tools didn't return (such as one awaiting approval)", async () => {
    const { result } = run(
      [
        [search],
        [
          toolUse("reply_to_customer", {
            message: "Pending Pixels is also great.",
            provider_ids: [ids.snapshot],
          }),
        ],
        [
          toolUse("reply_to_customer", {
            message: "Snapshot Studios fits best.",
            provider_ids: [ids.snapshot],
          }),
        ],
      ],
      ["Snapshot Studios", "Pending Pixels"],
    );
    expect((await result).draft.message).toBe("Snapshot Studios fits best.");
  });

  it("says the platform's exact words when nobody is registered for the request", async () => {
    const client = scriptedClient([
      [toolUse("search_providers", { service_query: "pool cleaning", category: "catering" })],
      [toolUse("reply_to_customer", { message: "Sorry, I couldn't find anyone for that." })],
    ]);
    const { draft } = await runAgent({
      client,
      model: "m",
      data: fakeData(),
      history: [],
      message: "pool cleaning in Lekki",
      knownBusinessNames: [],
    });
    expect(draft.message.startsWith(NO_PROVIDER_MESSAGE)).toBe(true);
    expect(draft.providerIds).toEqual([]);
  });

  it("refuses dates in the past and lets the model correct itself", async () => {
    const { client, result } = run([
      [toolUse("search_providers", { category: "photography-video", date: "2026-09-01" })],
      [search],
      [
        toolUse("reply_to_customer", {
          message: "Snapshot Studios fits best.",
          provider_ids: [ids.snapshot],
        }),
      ],
    ]);
    await result;
    expect(JSON.stringify(client.requests[1]!.messages.at(-1))).toContain("in the past");
  });

  it("starts a booking only with a real service, after reading the provider's details", async () => {
    const { result } = run([
      [search],
      [toolUse("get_provider_details", { provider_id: ids.snapshot, date: "2026-10-10" })],
      [
        toolUse("reply_to_customer", {
          message:
            "Tap Start booking to book Birthday & Party Coverage for ₦250,000. You'll confirm and pay on the next page.",
          provider_ids: [ids.snapshot],
          booking: { provider_id: ids.snapshot, service_ids: [ids.birthdayService], date: "2026-10-10" },
        }),
      ],
    ]);
    const { draft, verified } = await result;
    expect(verified).toBe(true);
    expect(draft.booking).toEqual({
      providerId: ids.snapshot,
      serviceIds: [ids.birthdayService],
      date: "2026-10-10",
    });
  });

  it("asks a clarifying question without searching", async () => {
    const client = scriptedClient([
      [
        toolUse("reply_to_customer", {
          message: "Happy to help! What kind of service do you need?",
          suggested_replies: ["Photographer", "Caterer"],
        }),
      ],
    ]);
    const { draft, verified } = await runAgent({
      client,
      model: "m",
      data: fakeData(),
      history: [],
      message: "hi",
      knownBusinessNames: [],
    });
    expect(verified).toBe(true);
    expect(draft.suggestions).toEqual(["Photographer", "Caterer"]);
  });

  it("gives the model earlier turns and the providers it showed", async () => {
    const client = scriptedClient([[toolUse("reply_to_customer", { message: "Which day works for you?" })]]);
    await runAgent({
      client,
      model: "m",
      data: fakeData(),
      history: [
        { role: "user", content: example },
        { role: "assistant", content: "Here are two options.", providerIds: [ids.snapshot] },
      ],
      message: "compare them",
      knownBusinessNames: [],
    });
    const sent = client.requests[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(String(sent[1]!.content)).toContain(ids.snapshot);
  });
});

describe("systemPrompt", () => {
  it("carries the platform rules and today's date", () => {
    const prompt = systemPrompt(fakeData());
    expect(prompt).toContain(NO_PROVIDER_MESSAGE);
    expect(prompt).toContain("Never invent");
    expect(prompt).toContain("never search the internet");
    expect(prompt).toContain("Never say a booking exists or a payment succeeded");
    expect(prompt).toContain("never take part in chat between customers and businesses");
    expect(prompt).toContain("2026-10-01");
  });
});
