import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const slug = process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e";
const adminBase = `${base}/${slug}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-17`;
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
const tuesday = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const browser = await chromium.launch();
const errors = [];
async function page(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
async function as(email, viewport) {
  const p = await page(viewport);
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
const settle = (p) => p.waitForLoadState("networkidle");

try {
  // ---- 1. Admin sets prices and the booking fee
  const admin = await as("admin@demo.ng");
  await admin.goto(`${adminBase}/revenue`);
  await settle(admin);
  for (const label of ["Booking commission", "Customer booking fees", "Subscriptions", "Featured placement"])
    check(`revenue page shows ${label}`, await sees(admin, label));
  check("booking fee starts off", await sees(admin, "No booking fee"));
  const fee = admin.getByRole("form", { name: "Customer booking fee" });
  await fee.getByLabel("Percentage (%)").fill("25");
  await fee.getByRole("button", { name: "Save" }).click();
  check("fee over 20% refused", await sees(admin, "Enter a percentage between 0 and 20."));
  await fee.getByLabel("Percentage (%)").fill("2.5");
  await fee.getByLabel("Fixed amount (₦)").fill("500");
  await fee.getByRole("button", { name: "Save" }).click();
  check("fee saved", await sees(admin, "Booking fee saved: 2.5% + ₦500"));
  check(
    "fee stored",
    sql(`select value::text from platform_settings where key='booking_fee'`).replace(/\s/g, "") ===
      '{"cap_minor":null,"flat_minor":50000,"percent_bps":250}',
  );
  const starter = admin.getByRole("form", { name: "Starter plan" });
  await starter.getByLabel("Monthly price (₦)").fill("30000");
  await starter.getByRole("button", { name: "Save" }).click();
  check("plan price saved", await sees(admin, "Starter saved: ₦30,000/month."));
  check(
    "plan price stored",
    sql(`select monthly_price_minor from subscription_plans where code='starter'`) === "3000000",
  );
  const free = admin.getByRole("form", { name: "Free plan" });
  check(
    "Free price can't be edited",
    await free.getByLabel("Monthly price (₦)").evaluate((el) => el.readOnly),
  );
  check(
    "changes are audited",
    sql(`select count(*) from admin_actions where action in ('settings.booking_fee','settings.plan')`) ===
      "2",
  );
  await shot(admin, "01-admin-revenue");

  // ---- 2. The customer sees the fee before booking and at checkout
  const customer = await as("customer@demo.ng");
  const owner = await as("owner@demo.ng");
  await customer.goto(base + "/book/lush-events-decor");
  await settle(customer);
  await customer.getByLabel(/Classic Wedding Decor/).check();
  await customer.getByLabel(/Fog machine/).check();
  const summary = await customer.locator("form > div").filter({ hasText: "Booking fee" }).last().innerText();
  check(
    "booking form shows the fee and total",
    summary.includes("Booking fee") && summary.includes("₦34,250") && summary.includes("₦1,384,250"),
    summary,
  );
  await customer.getByLabel("Date").fill(tuesday(14));
  await customer.getByLabel("Start time").fill("10:00");
  await customer.getByLabel("Address").fill("12 Admiralty Way");
  await customer.getByLabel("Area").fill("Lekki");
  await customer.getByLabel("City").fill("Lagos");
  await customer.getByLabel("State").fill("Lagos");
  await shot(customer, "02-booking-form-with-fee");
  await customer.getByRole("button", { name: "Send booking request" }).click();
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  const id = customer.url().match(/bookings\/([0-9a-f-]+)/)[1];
  check(
    "server priced the fee",
    sql(`select subtotal_minor||'|'||platform_fee_minor||'|'||total_minor from bookings where id='${id}'`) ===
      "135000000|3425000|138425000",
  );
  await owner.goto(`${base}/business/bookings/${id}`);
  await sees(owner, "Your price");
  const ownerView = await owner.locator("main").innerText();
  check(
    "business sees its own price, not the customer's fee",
    ownerView.includes("Your price") && ownerView.includes("₦1,350,000") && !ownerView.includes("₦1,384,250"),
    ownerView.slice(0, 500),
  );
  check("business sees what it receives", ownerView.includes("₦1,215,000"));
  await owner.getByRole("button", { name: "Accept booking" }).click();
  await sees(owner, "Accepted by the business");
  await customer.goto(`${base}/checkout/${id}`);
  const checkout = await customer.locator("main").innerText();
  check(
    "checkout shows the booking fee",
    checkout.includes("Booking fee") && checkout.includes("₦34,250") && checkout.includes("₦1,384,250"),
    checkout,
  );
  await shot(customer, "03-checkout-with-fee");
  await customer.getByRole("button", { name: /Pay .* securely/ }).click();
  await customer.waitForURL(/payment=success/, { timeout: 20000 });
  check(
    "payment split: fee and commission to the platform",
    sql(
      `select amount_minor||'|'||booking_fee_minor||'|'||platform_fee_minor||'|'||provider_amount_minor from payments where booking_id='${id}' and status='success'`,
    ) === "138425000|3425000|16925000|121500000",
  );

  // ---- 3. A business buys a plan
  await owner.goto(`${base}/business/plan`);
  await settle(owner);
  check("plan page lists four plans", (await owner.locator("[data-testid^=plan-]").count()) === 4);
  check("starts on Free", (await owner.getByTestId("plan-free").innerText()).includes("Current"));
  check(
    "shows the admin's price",
    (await owner.getByTestId("plan-starter").innerText()).includes("₦30,000/month"),
  );
  await shot(owner, "04-business-plans");
  await owner.getByTestId("plan-starter").getByRole("button", { name: "Choose Starter" }).click();
  await owner.waitForURL(/\/business\/plan\?payment=success/, { timeout: 20000 });
  check("payment confirmed", await sees(owner, "Payment received. Your plan is active."));
  check("now on Starter", (await owner.getByTestId("plan-starter").innerText()).includes("Current"));
  check("paid until shown", await sees(owner, /Paid until/));
  check(
    "charge recorded at the catalogue price",
    sql(
      `select kind||'|'||amount_minor||'|'||status from business_charges where business_id='c0000000-0000-0000-0000-000000000001'`,
    ) === "subscription|3000000|success",
  );
  check(
    "owner notified",
    sql(
      `select count(*) from notifications where type='billing.plan_started' and user_id='b0000000-0000-0000-0000-000000000001'`,
    ) === "1",
  );
  check("payment history listed", await sees(owner, "Payments to Concierge"));
  await shot(owner, "05-business-on-starter");

  // ---- 4. Featured placement: only for real matches
  const kemi = await as("kemi@demo.ng");
  await kemi.goto(`${base}/business/promote`);
  await settle(kemi);
  check(
    "explains featured never overrides matching",
    await sees(kemi, "Paying never puts you in front of customers you don’t match"),
  );
  await shot(kemi, "06-get-featured");
  await kemi.getByTestId("featured-week").getByRole("button", { name: /Pay/ }).click();
  await kemi.waitForURL(/\/business\/promote\?payment=success/, { timeout: 20000 });
  check("featured after paying", await sees(kemi, "You’re featured"));
  const lens = await as("lens@demo.ng");
  await lens.goto(`${base}/business/promote`);
  await settle(lens);
  await lens.getByTestId("featured-week").getByRole("button", { name: /Pay/ }).click();
  await lens.waitForURL(/payment=success/, { timeout: 20000 });

  const visitor = await page();
  await visitor.goto(`${base}/search?q=photographer&location=Victoria%20Island`);
  const cards = visitor
    .locator("main li")
    .filter({ has: visitor.getByRole("link", { name: "View profile" }) });
  await cards.first().waitFor();
  const first = await cards.first().innerText();
  check(
    "featured match shown first with a label",
    first.includes("Frames by Kemi") && first.includes("Featured"),
    first,
  );
  const lensCard = await cards
    .filter({ hasText: "Lens & Light" })
    .first()
    .innerText()
    .catch(() => "");
  check(
    "featured provider outside the area gets no label or lift",
    !lensCard || !lensCard.includes("Featured"),
    lensCard,
  );
  check("paid placement disclosed", await sees(visitor, "Featured providers pay for placement"));
  await shot(visitor, "07-search-featured");
  await visitor.goto(`${base}/search?q=photographer&location=Victoria%20Island&max=50000`);
  check(
    "over budget: no featured lift",
    (await visitor.getByText("Featured", { exact: true }).count()) === 0,
  );
  await visitor.goto(`${base}/search?q=photographer&sort=rating`);
  check(
    "sorting by rating ignores placement",
    (await visitor.getByText("Featured", { exact: true }).count()) === 0,
  );

  await visitor.goto(base + "/concierge");
  await visitor.locator("#concierge-message").fill("Find photographers in Victoria Island under ₦300k");
  await visitor.locator("#concierge-message").press("Enter");
  await visitor.getByText("Here’s what I understood").last().waitFor({ timeout: 20000 });
  const firstCard = await visitor.locator("[role=log] ol > li").first().innerText();
  check(
    "concierge shows the featured match first, labelled",
    firstCard.includes("Frames by Kemi") && firstCard.includes("Featured"),
    firstCard,
  );
  check(
    "concierge never shows the unapproved business",
    !(await visitor.locator("[role=log]").innerText()).includes("Pending Pixels"),
  );
  await shot(visitor, "08-concierge-featured");

  const pending = await as("pixels@demo.ng");
  await pending.goto(`${base}/business/promote`);
  check(
    "unapproved business can't buy placement",
    (await sees(pending, "available once your business is approved")) &&
      (await pending.getByRole("button", { name: /Pay/ }).count()) === 0,
  );
  await pending.goto(`${base}/business/plan`);
  check(
    "or a paid plan",
    (await sees(pending, "once your business is approved")) &&
      (await pending.getByRole("button", { name: /Choose/ }).count()) === 0,
  );

  // ---- 5. Revenue adds up
  await admin.goto(`${adminBase}/revenue`);
  await sees(admin, "Recent business payments");
  const revenue = await admin.locator("main").innerText();
  check("subscriptions counted", revenue.includes("₦30,000"), revenue.slice(0, 600));
  check("featured counted", revenue.includes("₦20,000"));
  check("booking fee counted", revenue.includes("₦34,250"));
  check("recent payments listed", revenue.includes("Frames by Kemi") && revenue.includes("Lush Events"));
  await shot(admin, "09-admin-revenue-after");

  // ---- 6. Phone
  const phone = await as("owner@demo.ng", { width: 390, height: 844 });
  for (const path of ["/business/plan", "/business/promote"]) {
    await phone.goto(base + path);
    check(
      `no horizontal scroll on ${path}`,
      await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    );
  }
  await shot(phone, "10-mobile-promote");
  const adminPhone = await as("admin@demo.ng", { width: 390, height: 844 });
  await adminPhone.goto(`${adminBase}/revenue`);
  check(
    "no horizontal scroll on admin revenue",
    await adminPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  results.push(`ERROR ${e.message.split("\n").join(" | ")}`);
} finally {
  await browser.close();
  console.log(results.join("\n"));
  console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
}
