import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-6`;
execSync(`mkdir -p ${shots}`);
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
const shot = (p, name) => p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

// "next Saturday" = Saturday of next week (weeks start Monday), in Lagos.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const d = new Date(`${today}T12:00:00Z`);
const toNextMonday = (8 - d.getUTCDay()) % 7 || 7;
d.setUTCDate(d.getUTCDate() + toNextMonday + 5);
const saturday = d.toISOString().slice(0, 10);
const satLabel = new Intl.DateTimeFormat("en-NG", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
}).format(d);

const sees = (p, text) =>
  p
    .getByText(text)
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      () => false,
    );

const example =
  "I need a photographer for a birthday in Victoria Island next Saturday. About 100 people. Budget ₦300k.";

const browser = await chromium.launch();
const errors = [];
for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  try {
    // Concierge: Francis's example typed into the box
    await p.goto(base + "/concierge");
    await p.locator("textarea, input[name=q]").first().fill(example);
    await p.locator("textarea, input[name=q]").first().press("Enter");
    await p.waitForURL(/\/concierge/);
    await p.getByText("Here’s what I understood").waitFor();
    const understood = await p.locator("dl").first().innerText();
    for (const part of [
      "Photography & video",
      "Birthday",
      "Victoria Island, Lagos",
      satLabel,
      "100",
      "₦300,000",
    ])
      check(
        `${label} understood ${part}`,
        understood.toLowerCase().includes(part.toLowerCase()),
        JSON.stringify(understood),
      );
    const cards = p.locator("main ol").first().locator("> li");
    const first = await cards.first().innerText();
    check(`${label} best match is Snapshot`, first.includes("Snapshot Studios"));
    check(
      `${label} best match reasons`,
      [
        "Serves Victoria Island",
        `Available ${satLabel}`,
        "within your ₦300k budget",
        "Handles up to 150 guests",
        "Verified by our team",
      ].every((t) => first.includes(t)),
      first,
    );
    const main = await p.locator("main").innerText();
    check(`${label} close options heading`, main.includes("Close options"));
    check(
      `${label} Frames flagged`,
      main.includes("Frames by Kemi") &&
        main.includes(`Not working that day (${satLabel})`) &&
        main.includes("fewer than your 100"),
    );
    check(
      `${label} Lens nearby + over budget`,
      main.includes("Lens & Light") &&
        main.includes("above your ₦300k budget") &&
        main.includes("Works nearby"),
    );
    check(
      `${label} paused/pending excluded`,
      !main.includes("Paused Photo") && !main.includes("Pending Pixels"),
    );
    await shot(p, `${label}-01-concierge-example`);

    // Earlier homepage example still works
    await p.goto(
      base +
        "/concierge?q=" +
        encodeURIComponent("I need a wedding decorator in Lekki for 300 guests with a ₦1.5m budget."),
    );
    await p.getByText("Here’s what I understood").waitFor();
    check(`${label} wedding example finds Lush`, await sees(p, "Lush Events"));
    const wed = await p.locator("main").innerText();
    check(`${label} hides unverified`, !wed.includes("Unverified Decor Hub"));

    // Search with structured filters
    await p.goto(`${base}/search?q=birthday&location=vi&date=${saturday}&guests=100&max=300000`);
    check(`${label} search finds Snapshot`, await sees(p, "Snapshot Studios"));
    const search = await p.locator("main").innerText();
    check(`${label} search max price hides Lens`, !search.includes("Lens & Light"));
    check(
      `${label} search shows availability`,
      search.includes(`Available ${satLabel}`) && search.includes("Not working that day"),
    );
    check(`${label} filters keep date`, (await p.locator("input[name=date]").inputValue()) === saturday);
    check(`${label} filters keep guests`, (await p.locator("input[name=guests]").inputValue()) === "100");
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`${label} no horizontal scroll`, !overflow);
    await shot(p, `${label}-02-search-filters`);

    const bad = await p.goto(`${base}/search?date=2026-02-31&guests=abc&max=99999999999999999999`);
    check(`${label} bad filters don't crash`, bad.status() === 200);

    await p.goto(base + "/");
    check(`${label} home renders`, await sees(p, "Tell us what you need"));
  } catch (e) {
    check(`${label} crashed`, false, e.message);
    await shot(p, `${label}-crash`);
  }
  await ctx.close();
}
await browser.close();
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
