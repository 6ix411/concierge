import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-8`;
execSync(`mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q}"`,
  )
    .toString()
    .trim();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
const shot = (p, name) => p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const sees = (p, text, timeout = 15000) =>
  p
    .getByText(text)
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );

const browser = await chromium.launch();
const errors = [];
for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  try {
    // Concierge results cards
    await p.goto(base + "/concierge?q=" + encodeURIComponent("Wedding photographer in Lekki"));
    await sees(p, "Lens & Light Photography");
    const card = p.locator("[role=log] ol > li").filter({ hasText: "Lens & Light Photography" }).first();
    const text = await card.innerText();
    check(
      `${label} card price for matching service`,
      text.includes("₦600,000") && !text.includes("₦1,100,000"),
      text,
    );
    check(`${label} card verified + rating`, text.includes("Verified") && text.includes("5.0"));
    check(`${label} card completed bookings`, text.includes("1 completed booking"));
    check(`${label} card areas`, text.includes("Lekki"));
    for (const name of ["View profile", "Book"])
      check(`${label} card ${name}`, (await card.getByRole("link", { name }).count()) === 1);
    check(`${label} card compare`, (await card.getByLabel("Compare").count()) === 1);
    await shot(p, `${label}-01-concierge-cards`);

    // Search cards and compare
    await p.goto(base + "/search?category=photography-video");
    await sees(p, "Snapshot Studios");
    const boxes = p.getByLabel("Compare");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    // Desktop has "Compare selected" at the end of the list; phones get a bar above the tab bar.
    await p
      .getByRole("button", { name: label === "mobile" ? "Compare" : "Compare selected", exact: true })
      .click();
    await p.waitForURL(/\/compare/);
    check(`${label} compare from search`, await sees(p, "Compare providers"));
    await p.goto(base + "/search?category=photography-video");
    await sees(p, "Snapshot Studios");
    const lensCard = await p
      .locator("li")
      .filter({ hasText: "Lens & Light Photography" })
      .first()
      .innerText();
    check(`${label} search card full price range`, lensCard.includes("₦600,000–₦1,100,000"), lensCard);
    await shot(p, `${label}-02-search-cards`);

    // Profile
    await p.goto(base + "/businesses/lens-and-light");
    await sees(p, "Lens & Light Photography");
    const main = await p.locator("main").innerText();
    const facts = {
      name: main.includes("Lens & Light Photography"),
      verified: main.includes("Documents checked by the Concierge team"),
      description: main.length > 0,
      location: main.includes("Based in"),
      areas: main.includes("Service areas") && main.includes("Lekki, Lagos"),
      rating: main.includes("5.0 from 1 review"),
      breakdown: main.includes("5 star"),
      completed: main.includes("1 completed booking"),
      pricing: main.includes("₦600,000–₦1,100,000"),
      services: main.includes("Wedding Photography (full day)"),
      packages: main.includes("Packages"),
      portfolio: main.includes("Portfolio"),
      reviews: main.includes("Reviews"),
      availability: main.includes("Availability") && main.includes("Monday"),
      notice: main.includes("Book at least"),
      daysOff: main.includes("Upcoming days off"),
    };
    for (const [key, ok] of Object.entries(facts)) check(`${label} profile ${key}`, ok);
    check(
      `${label} logo or initials`,
      (await p.locator("main header").first().innerText()).includes("LL") ||
        (await p.locator("main header img").count()) > 0,
    );
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`${label} no horizontal scroll`, !overflow);
    await shot(p, `${label}-03-profile-lens`);

    await p.goto(base + "/businesses/lush-events-decor");
    await sees(p, "Lush Events");
    const lush = await p.locator("main").innerText();
    check(`${label} lush packages + add-ons`, lush.includes("Packages") && lush.includes("Add-ons"));
    await shot(p, `${label}-04-profile-lush`);

    // Not approved: no profile
    const res = await p.goto(base + "/businesses/pending-pixels");
    check(
      `${label} pending business hidden`,
      (await p.locator("main").innerText()).toLowerCase().includes("not found") || res.status() === 404,
    );
  } catch (e) {
    check(`${label} crashed`, false, e.message);
    await shot(p, `${label}-crash`);
  }
  await ctx.close();
}
await browser.close();
// Database agrees with the page
check(
  "db completed bookings for Lens",
  sql("select completed_bookings from get_business_stats('c0000000-0000-0000-0000-000000000007')") === "1",
);
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
