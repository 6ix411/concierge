import { describe, expect, it } from "vitest";

import { Facts } from "./facts";
import { checkReply } from "./guard";

const KEMI = "c0000000-0000-0000-0000-000000000007";

function context() {
  const facts = new Facts();
  facts.provider({
    id: KEMI,
    name: "Frames by Kemi",
    slug: "frames-by-kemi",
    rating_avg: 4.5,
    rating_count: 2,
  });
  return { facts, customerText: "", knownBusinessNames: ["Frames by Kemi"], today: "2026-10-03" };
}
const check = (message: string, ctx = context()) =>
  checkReply({ message, providerIds: [KEMI], compare: false, booking: null, suggestions: [] }, ctx);

describe("reply guard: nothing the database didn't return", () => {
  it("accepts ratings and review counts exactly as returned", () => {
    expect(check("Frames by Kemi is rated 4.5 from 2 reviews.")).toEqual([]);
  });

  it("refuses invented ratings however they are written", () => {
    for (const text of ["a 4.8-star photographer", "rating: 4.9", "a 4.7 rating", "4.6/5 from customers"])
      expect(check(`Frames by Kemi has ${text}.`).join(" ")).toMatch(/isn't in the tool results/);
  });

  it("refuses invented review counts", () => {
    expect(check("Frames by Kemi has 40 verified reviews.").join(" ")).toMatch(
      /40 reviews isn't in the tool results/,
    );
  });

  it("refuses availability claims before any date was checked", () => {
    for (const text of [
      "They're available Saturday.",
      "Frames by Kemi has availability that weekend.",
      "She's still free next week.",
    ])
      expect(check(text).join(" ")).toMatch(/haven't checked availability/);
  });

  it("allows availability once the date was checked", () => {
    const ctx = context();
    ctx.facts.datesChecked.add("2026-10-10");
    expect(check("They're available on 10 October.", ctx)).toEqual([]);
  });
});
