import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const slug = process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e";
const adminBase = `${base}/${slug}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-18`;
execSync(`mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q}"`,
  )
    .toString()
    .trim();
const count = (q) => Number(sql(q));
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const events = (where = "true") => count(`select count(*) from analytics_events where ${where}`);
const CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

const browser = await chromium.launch();
const errors = [];
async function page({ viewport = { width: 1280, height: 900 }, userAgent = CHROME } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, userAgent });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
async function as(email, opts) {
  const p = await page(opts);
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
const settle = (p) => p.waitForLoadState("networkidle");

try {
  // ---- 1. Searches and the providers they show
  const visitor = await page();
  await visitor.goto(`${base}/search?q=photographer&location=Victoria+Island`);
  await settle(visitor);
  await wait(800);
  check("a search is counted", events(`event_type='search' and source='search'`) === 1, String(events()));
  const shown = count(`select result_count from analytics_events where event_type='search'`);
  check(
    "each provider it showed is a match",
    events(`event_type='provider_match'`) === shown && shown > 0,
    `${events(`event_type='provider_match'`)} vs ${shown}`,
  );
  check(
    "the place is kept as the platform understood it",
    sql(`select state || '/' || coalesce(city,'') from analytics_events where event_type='search'`) ===
      "Lagos/Lagos",
    sql(`select state || '/' || coalesce(city,'') from analytics_events where event_type='search'`),
  );
  check(
    "result count stored",
    shown > 0 && (await visitor.getByRole("link", { name: /Frames by Kemi/ }).count()) > 0,
  );
  await visitor.goto(`${base}/search?q=photographer&location=Victoria+Island&page=2`);
  await settle(visitor);
  await visitor.goto(`${base}/search`);
  await settle(visitor);
  await wait(800);
  check(
    "later pages and empty searches aren't extra searches",
    events(`event_type='search'`) === 1,
    String(events(`event_type='search'`)),
  );
  await visitor.goto(`${base}/search?category=catering`);
  await settle(visitor);
  await wait(800);
  check(
    "a category search records its category",
    events(
      `event_type='search' and category_id = (select id from service_categories where slug='catering')`,
    ) === 1,
  );
  await visitor.goto(`${base}/search?q=cake&location=Mars+Colony`);
  await settle(visitor);
  await wait(800);
  check(
    "a place we don't recognise isn't stored",
    count(
      `select count(*) from analytics_events where event_type='search' and state is null and category_id is null`,
    ) === 1,
  );

  const bot = await page({
    userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  });
  await bot.goto(`${base}/search?q=photographer`);
  await bot.goto(`${base}/businesses/frames-by-kemi`);
  await settle(bot);
  const headless = await page({ userAgent: "Mozilla/5.0 HeadlessChrome/129.0" });
  await headless.goto(`${base}/businesses/frames-by-kemi`);
  await settle(headless);
  await wait(800);
  check(
    "crawlers aren't counted",
    events(`event_type='search'`) === 3 && events(`event_type='profile_view'`) === 0,
    `${events(`event_type='search'`)} / ${events(`event_type='profile_view'`)}`,
  );

  // ---- 2. Profile views
  await visitor.goto(`${base}/businesses/frames-by-kemi`);
  await settle(visitor);
  await wait(800);
  check(
    "a profile view is counted",
    events(`event_type='profile_view'`) === 1,
    String(events(`event_type='profile_view'`)),
  );
  await visitor.reload();
  await settle(visitor);
  await wait(800);
  check("reloading doesn't count again", events(`event_type='profile_view'`) === 1);
  const second = await page({ viewport: { width: 390, height: 844 } });
  await second.goto(`${base}/businesses/frames-by-kemi`);
  await settle(second);
  await wait(800);
  check("another visitor counts", events(`event_type='profile_view'`) === 2);
  const kemi = await as("kemi@demo.ng");
  await kemi.goto(`${base}/businesses/frames-by-kemi`);
  await settle(kemi);
  const admin = await as("admin@demo.ng");
  await admin.goto(`${base}/businesses/frames-by-kemi`);
  await settle(admin);
  await wait(800);
  check(
    "the owner's and admins' visits don't count",
    events(`event_type='profile_view'`) === 2,
    String(events(`event_type='profile_view'`)),
  );
  const forged = await second.evaluate(async () => {
    const r = await fetch("/businesses/frames-by-kemi", { method: "POST", body: "x" });
    return r.status;
  });
  check("a junk post doesn't add views", events(`event_type='profile_view'`) === 2, String(forged));
  check(
    "views for a pending business are never recorded",
    events(`event_type='profile_view' and business_id='c0000000-0000-0000-0000-000000000013'`) === 0,
  );

  // ---- 3. The concierge
  const customer = await as("customer@demo.ng");
  await customer.goto(base + "/concierge");
  await settle(customer);
  const before = await customer.locator("[role=log] > div").count();
  await customer.locator("#concierge-message").fill("I need a photographer in Victoria Island");
  await customer.locator("#concierge-message").press("Enter");
  await customer.waitForFunction(
    (n) => document.querySelectorAll("[role=log] > div").length >= n + 2,
    before,
    { timeout: 20000 },
  );
  await wait(1500);
  check(
    "a concierge search is counted once",
    events(`event_type='search' and source='concierge'`) === 1,
    String(events(`event_type='search' and source='concierge'`)),
  );
  check("with its matches", events(`event_type='provider_match' and source='concierge'`) > 0);
  check(
    "events carry no personal data",
    sql(
      `select string_agg(distinct coalesce(state,'') || coalesce(city,''), ',') from analytics_events`,
    ).includes("customer") === false,
  );
  check(
    "table has only the expected columns",
    sql(
      `select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='analytics_events'`,
    ) === "id,event_type,source,business_id,category_id,state,city,result_count,occurred_at",
  );

  // ---- 4. The admin dashboard
  await admin.goto(`${adminBase}/analytics`);
  await settle(admin);
  for (const label of [
    "Customer registrations",
    "Business registrations",
    "Businesses approved",
    "Searches",
    "AI conversations",
    "Provider matches",
    "Profile views",
    "Booking requests",
    "Confirmed bookings",
    "Completed bookings",
    "Cancellations",
    "Customer payments",
    "Platform commission",
    "Provider earnings",
    "Average booking value",
    "Popular categories",
    "Popular locations",
    "Conversion",
  ])
    check(`analytics shows ${label}`, await sees(admin, label));
  const stat = (label) =>
    admin.getByText(label, { exact: true }).locator("xpath=..").locator("span.text-2xl");
  const searches = stat("Searches");
  check(
    "searches total matches the events",
    (await searches.innerText()) === "4",
    await searches.innerText(),
  );
  check("profile views total", (await stat("Profile views").innerText()) === "2");
  check("conversion rates shown", await sees(admin, "Searches that found a provider"));
  check("explains what is recorded", await sees(admin, "without recording who"));
  await shot(admin, "01-admin-analytics");
  await admin.getByRole("link", { name: "Last 7 days" }).click();
  await admin.waitForURL(/period=7d/);
  check("period switch", await sees(admin, "Customer registrations"));
  check(
    "nav has Analytics",
    await admin
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Analytics" })
      .isVisible(),
  );
  const adminPhone = await as("admin@demo.ng", { viewport: { width: 390, height: 844 } });
  await adminPhone.goto(`${adminBase}/analytics`);
  await settle(adminPhone);
  const overflow = await adminPhone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("analytics fits a phone", overflow <= 0, String(overflow));
  await shot(adminPhone, "02-admin-analytics-phone");

  // ---- 5. Access
  const plain = await customer.goto(`${adminBase}/analytics`);
  check(
    "customers can't open analytics",
    (await customer.content()).includes("could not be found") || plain.status() === 404,
  );
  check("the internal path is hidden", (await kemi.goto(`${base}/admin/analytics`)).status() === 404);

  // ---- 6. The business's own numbers
  await kemi.goto(`${base}/business`);
  await settle(kemi);
  const insights = kemi.getByTestId("business-insights");
  check("business sees its last 30 days", await sees(kemi, "Last 30 days"));
  const text = await insights.innerText();
  check("with its own profile views", /Profile views\s*2/.test(text), text);
  check("and search appearances", /Shown in searches\s*[1-9]/.test(text), text);
  await shot(kemi, "03-business-insights");
  const pending = await as("pixels@demo.ng");
  await pending.goto(`${base}/business`);
  await settle(pending);
  check("unapproved businesses don't see it", !(await pending.getByText("Last 30 days").isVisible()));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("suite ran", false, error.stack);
}
await browser.close();
console.log(results.join("\n"));
console.log(
  `${results.filter((r) => r.startsWith("PASS")).length} passed, ${results.filter((r) => r.startsWith("FAIL")).length} failed`,
);
