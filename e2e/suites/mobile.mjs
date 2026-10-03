// Stage 19: the whole customer journey on a phone, by tapping, from discovery to review.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-19`;
execSync(`mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q}"`,
  )
    .toString()
    .trim();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
const sees = (p, text, timeout = 15000) =>
  p
    .getByText(text)
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );
const settle = (p) => p.waitForLoadState("networkidle").catch(() => {});
let n = 0;
const shot = (p, name) => p.screenshot({ path: `${shots}/${String(++n).padStart(2, "0")}-${name}.png` });
const tuesday = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const browser = await chromium.launch();
const errors = [];
const phone = devices["iPhone 13"]; // 390 x 844, touch, mobile Safari UA
async function as(email, device = phone) {
  const { defaultBrowserType: _browserType, ...options } = device;
  const ctx = await browser.newContext(options);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).tap();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
const fits = async (p, where) => {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${where} fits the screen`, overflow <= 0, `${overflow}px`);
};
const tabBar = (p) => p.getByRole("navigation", { name: "Main" });
// Something the customer has to tap must be on screen and not hidden under the tab bar.
async function reachable(p, locator, name) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await locator.boundingBox();
  const bar = await tabBar(p).boundingBox();
  const ok = box && bar && box.y + box.height <= bar.y + 1 && box.height >= 36;
  check(`${name} can be tapped`, Boolean(ok), JSON.stringify({ box, bar }));
}

try {
  const customer = await as("customer@demo.ng");
  const kemi = await as("kemi@demo.ng");

  // ---- Discover: describe the job on the home page
  await customer.goto(base + "/");
  await settle(customer);
  await fits(customer, "home");
  check("tab bar on phones", await tabBar(customer).isVisible());
  await customer.locator("#concierge-query").fill("I need a family photographer in Victoria Island");
  await customer.getByRole("button", { name: /Find My Provider/ }).tap();
  await customer.waitForURL(/\/concierge/, { timeout: 15000 });

  // ---- Match: the concierge answers with verified providers
  await customer
    .getByText("Checking verified providers")
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => {});
  check("concierge shows matches", await sees(customer, "Frames by Kemi", 20000));
  await settle(customer);
  await fits(customer, "concierge");
  const composer = customer.locator("#concierge-message");
  const cbox = await composer.boundingBox();
  const bar = await tabBar(customer).boundingBox();
  check(
    "message box sits above the tab bar",
    cbox && bar && cbox.y + cbox.height <= bar.y,
    JSON.stringify({ cbox, bar }),
  );
  await shot(customer, "concierge-matches");

  // ---- Compare
  const ticks = customer
    .locator("label", { hasText: "Compare" })
    .filter({ has: customer.locator('input[name="ids"]') });
  const tickCount = await ticks.count();
  check("concierge offers compare", tickCount >= 2, String(tickCount));
  await ticks.nth(0).tap();
  await ticks.nth(1).tap();
  const compareButton = customer.getByRole("button", { name: "Compare selected" });
  await reachable(customer, compareButton, "Compare selected");
  await compareButton.tap();
  await customer.waitForURL(/\/compare\?/, { timeout: 15000 });
  await settle(customer);
  await fits(customer, "compare");
  const columns = await customer.locator("thead th").count();
  check("two providers side by side", columns === 3, String(columns));
  const table = await customer.locator("table").boundingBox();
  check("two providers fit without scrolling sideways", table && table.width <= 390, JSON.stringify(table));
  await shot(customer, "compare");

  // Compare from search too: the bar appears once something is ticked.
  const searcher = await as("emeka@demo.ng");
  await searcher.goto(`${base}/search?q=photographer&location=Lekki`);
  await settle(searcher);
  const first = await searcher
    .locator("article, li")
    .filter({ has: searcher.locator('input[name="ids"]') })
    .first()
    .boundingBox()
    .catch(() => null);
  check("results start on the first screen", first && first.y < 844, JSON.stringify(first));
  check("extra filters fold away", !(await searcher.getByLabel("Max budget (₦)").isVisible()));
  await searcher.getByRole("button", { name: "More filters" }).tap();
  check("and open with one tap", await searcher.getByLabel("Max budget (₦)").isVisible());
  check("no compare bar before ticking", (await searcher.getByTestId("compare-bar").count()) === 0);
  await searcher.locator("label", { hasText: "Compare" }).first().tap();
  check("compare bar after one tick", await sees(searcher, "Tick one more to compare"));
  await searcher.locator("label", { hasText: "Compare" }).nth(1).tap();
  await reachable(
    searcher,
    searcher.getByTestId("compare-bar").getByRole("button", { name: "Compare" }),
    "search compare bar",
  );
  await shot(searcher, "search-compare-bar");
  await searcher.getByTestId("compare-bar").getByRole("button", { name: "Compare" }).tap();
  await searcher.waitForURL(/\/compare\?/, { timeout: 15000 });
  check("compare from search", (await searcher.locator("thead th").count()) === 3);

  // ---- Book
  const bookKemi = customer.locator('a[href="/book/frames-by-kemi"]').first();
  await bookKemi.tap();
  await customer.waitForURL(/\/book\/frames-by-kemi/, { timeout: 15000 });
  await settle(customer);
  await fits(customer, "booking form");
  check(
    "no booking bar before a service is chosen",
    (await customer.getByTestId("booking-bar").count()) === 0,
  );
  await customer.getByText("Family Portrait Session").tap();
  check(
    "booking bar shows the total",
    (await sees(customer, "₦80,000")) && (await customer.getByTestId("booking-bar").isVisible()),
  );
  await shot(customer, "booking-bar");
  await customer.getByLabel("Date").fill(tuesday(10));
  await customer.getByLabel("Start time").fill("10:00");
  await customer.getByLabel("Address").fill("5 Adeola Odeku Street");
  await customer.getByLabel("Area").fill("Victoria Island");
  await customer.getByTestId("booking-bar").getByRole("button", { name: "Send request" }).tap();
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  const id = customer.url().match(/bookings\/([0-9a-f-]+)/)[1];
  check("booked from the bar", sql(`select status from bookings where id='${id}'`) === "pending_provider");
  await settle(customer);
  await fits(customer, "booking sent");
  await shot(customer, "booking-sent");

  // The business answers from its phone.
  await kemi.goto(`${base}/business/bookings`);
  await settle(kemi);
  await fits(kemi, "business bookings");
  await kemi.locator(`a[href="/business/bookings/${id}"]`).first().tap();
  await kemi.getByRole("button", { name: "Accept booking" }).tap();
  check("business accepts on a phone", await sees(kemi, "Accepted by the business"));
  await fits(kemi, "business booking");

  // ---- Pay
  await tabBar(customer).getByRole("link", { name: "Bookings" }).tap();
  await customer.waitForURL(/\/account\/bookings$/);
  await customer.locator(`a[href="/account/bookings/${id}"]`).first().tap();
  await customer.waitForURL(new RegExp(id));
  const pay = customer.getByRole("link", { name: /Pay ₦/ });
  await reachable(customer, pay, "Pay");
  await pay.tap();
  await customer.waitForURL(/\/checkout\//);
  await settle(customer);
  await fits(customer, "checkout");
  await shot(customer, "checkout");
  const payNow = customer.getByRole("button", { name: /Pay .* securely/ });
  await reachable(customer, payNow, "Pay securely");
  await payNow.tap();
  await customer.getByText("Payment received").first().waitFor({ timeout: 20000 });
  check("paid on a phone", sql(`select status from bookings where id='${id}'`) === "confirmed");
  await fits(customer, "paid booking");

  // ---- Chat
  const message = customer.getByRole("link", { name: /Message Frames by Kemi/ });
  await reachable(customer, message, "Message the business");
  await message.tap();
  await customer.waitForURL(/\/account\/messages\//);
  await settle(customer);
  await fits(customer, "chat");
  const box = customer.locator("#chat-body");
  const chatBox = await box.boundingBox();
  const chatBar = await tabBar(customer).boundingBox();
  check(
    "chat box sits above the tab bar",
    chatBox && chatBar && chatBox.y + chatBox.height <= chatBar.y,
    JSON.stringify({ chatBox, chatBar }),
  );
  check(
    "chat box doesn't zoom the page",
    (await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16,
  );
  await box.fill("Hi Kemi, can we start at 10 sharp?");
  await customer.getByRole("button", { name: /Send/ }).tap();
  check("message sent", await sees(customer, "can we start at 10 sharp"));
  await shot(customer, "chat");
  await kemi.goto(`${base}/business/messages`);
  await kemi.getByText("can we start at 10 sharp").first().tap();
  await kemi.locator("#chat-body").fill("Yes, see you then!");
  await kemi.getByRole("button", { name: /Send/ }).tap();
  check("business replies", await sees(customer, "see you then", 20000));
  const kbox = await kemi.locator("#chat-body").boundingBox();
  const vh = kemi.viewportSize().height;
  check(
    "business chat box at the bottom of the screen",
    kbox && kbox.y + kbox.height > vh - 80 && kbox.y + kbox.height <= vh,
    JSON.stringify(kbox),
  );

  // The job happens.
  await kemi.goto(`${base}/business/bookings/${id}`);
  await kemi.getByRole("button", { name: "Mark as started" }).tap();
  await sees(kemi, "Job started");
  await kemi.getByRole("button", { name: "Mark as completed" }).tap();
  check("business completes on a phone", await sees(kemi, "Job completed"));

  // ---- Review
  await tabBar(customer).getByRole("link", { name: "Bookings" }).tap();
  await customer.waitForURL(/\/account\/bookings$/);
  await customer
    .getByRole("tab", { name: "Past" })
    .or(customer.getByRole("link", { name: "Past" }))
    .first()
    .tap()
    .catch(() => {});
  await customer.locator(`a[href="/account/bookings/${id}"]`).first().tap();
  await customer.waitForURL(new RegExp(id));
  const review = customer.getByRole("link", { name: "Leave a review" });
  await reachable(customer, review, "Leave a review");
  await review.tap();
  await settle(customer);
  await fits(customer, "review");
  await customer.getByRole("button", { name: /5 stars/ }).tap();
  const post = customer.getByRole("button", { name: "Post review" });
  await reachable(customer, post, "Post review");
  await shot(customer, "review");
  await post.tap();
  await customer.waitForURL(/reviewed=1/, { timeout: 15000, waitUntil: "commit" });
  check("reviewed on a phone", sql(`select status from bookings where id='${id}'`) === "reviewed");

  // ---- Small phones and the business side
  const small = await as("customer@demo.ng", { ...devices["iPhone SE"] });
  for (const path of [
    "/",
    "/search?q=cleaning",
    "/concierge",
    "/businesses/frames-by-kemi",
    "/book/frames-by-kemi",
    `/account/bookings/${id}`,
    "/account",
  ]) {
    await small.goto(base + path);
    await settle(small);
    await fits(small, `${path} on a 320px phone`);
  }
  const header = await kemi.locator("header").boundingBox();
  check("business header stays on one line", header && header.height <= 60, JSON.stringify(header));
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("suite ran", false, error.stack);
}
await browser.close();
console.log(results.join("\n"));
console.log(
  `${results.filter((r) => r.startsWith("PASS")).length} passed, ${results.filter((r) => r.startsWith("FAIL")).length} failed`,
);
