import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const slug = process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e";
const adminBase = `${base}/${slug}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-14`;
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
const badge = (p) => p.getByTestId("notification-count");
const badgeIs = async (p, text, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const n = await badge(p).count();
    const value = n ? (await badge(p).innerText()).trim() : "none";
    if (value === text) return true;
    await p.waitForTimeout(300);
  }
  return false;
};

const browser = await chromium.launch();
const errors = [];
async function as(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
const unread = (user) =>
  sql(`select count(*) from notifications where user_id='${user}' and read_at is null`);
const EMEKA = "a0000000-0000-0000-0000-000000000003";
const tuesday = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

try {
  // ---- 1. Registration
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const fresh = await ctx.newPage();
  fresh.on("pageerror", (e) => errors.push(`signup: ${e.message}`));
  await fresh.goto(base + "/sign-up");
  await fresh.getByLabel("Full name").fill("Ngozi Test");
  await fresh.getByLabel("Email").fill("ngozi-n14@test.ng");
  await fresh.getByLabel("Password").fill("Password123");
  await fresh.getByRole("button", { name: /Create account|Sign up/ }).click();
  await fresh.waitForURL((url) => !url.pathname.startsWith("/sign-up"), { timeout: 20000 });
  const ngozi = sql(`select id from users where email='ngozi-n14@test.ng'`);
  check(
    "welcome notification on registration",
    sql(`select type||'|'||title from notifications where user_id='${ngozi}'`) ===
      "account.welcome|Welcome to Concierge",
  );
  check("bell shows 1 unread for the new customer", await badgeIs(fresh, "1"));
  await fresh.goto(base + "/notifications");
  check("notification centre lists the welcome", await sees(fresh, "Welcome to Concierge"));
  await fresh.getByRole("link", { name: /Welcome to Concierge/ }).click();
  await fresh.waitForURL(/\/concierge/, { timeout: 15000 });
  check("opening the welcome goes to the Concierge and marks it read", unread(ngozi) === "0");
  check("bell clears after reading", await badgeIs(fresh, "none"));

  // ---- 2. Booking request reaches the business live
  const customer = await as("customer@demo.ng");
  const owner = await as("owner@demo.ng");
  const ownerId = sql(`select id from users where email='owner@demo.ng'`);
  const customerId = sql(`select id from users where email='customer@demo.ng'`);
  sql(`update notifications set read_at=now() where user_id in ('${ownerId}','${customerId}')`);
  await owner.goto(base + "/business");
  await customer.goto(base + "/notifications");
  await customer.reload();
  check("no badge when everything is read", await badgeIs(owner, "none"));
  await customer.goto(base + "/book/lush-events-decor");
  await customer.getByLabel(/Classic Wedding Decor/).check();
  await customer.getByLabel("Date").fill(tuesday(14));
  await customer.getByLabel("Start time").fill("10:00");
  await customer.getByLabel("Address").fill("12 Admiralty Way");
  await customer.getByLabel("Area").fill("Lekki");
  await customer.getByLabel("City").fill("Lagos");
  await customer.getByLabel("State").fill("Lagos");
  await customer.getByRole("button", { name: "Send booking request" }).click();
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  const id = customer.url().match(/bookings\/([0-9a-f-]+)/)[1];
  const ref = sql(`select reference from bookings where id='${id}'`);
  check(
    "booking request notifies the business",
    sql(
      `select count(*) from notifications where user_id='${ownerId}' and type='booking.requested' and data->>'bookingId'='${id}'`,
    ) === "1",
  );
  check("business bell updates live, without reloading", await badgeIs(owner, "1", 20000));

  // ---- 3. Accept, pay: the customer is told each time
  await owner.goto(`${base}/business/bookings/${id}`);
  await owner.getByRole("button", { name: "Accept booking" }).click();
  await sees(owner, "Accepted by the business");
  check(
    "acceptance notifies the customer",
    sql(
      `select count(*) from notifications where user_id='${customerId}' and type='booking.accepted' and data->>'bookingId'='${id}'`,
    ) === "1",
  );
  await customer.goto(`${base}/checkout/${id}`);
  await customer.getByRole("button", { name: /Pay .* securely/ }).click();
  await customer.getByText("Payment received").first().waitFor({ timeout: 20000 });
  check(
    "payment confirmation to both sides",
    sql(
      `select count(*) from notifications where type='payment.confirmed' and data->>'bookingId'='${id}' and user_id in ('${ownerId}','${customerId}')`,
    ) === "2",
  );

  // ---- 4. A chat message
  const conv = sql(`select id from conversations where booking_id='${id}'`);
  await owner.goto(`${base}/business/messages/${conv}`);
  await owner.getByPlaceholder(/message/i).fill("Thanks for booking! We'll arrive at 7am.");
  await owner.getByRole("button", { name: "Send" }).click();
  await sees(owner, "We'll arrive at 7am");
  check(
    "new chat message notifies the customer",
    sql(
      `select count(*) from notifications where user_id='${customerId}' and type='message.new' and data->>'conversationId'='${conv}'`,
    ) === "1",
  );

  // ---- 5. The notification centre
  await customer.goto(base + "/notifications");
  check("customer bell counts accepted, paid and message", await badgeIs(customer, "3"));
  await sees(customer, "Unread (3)");
  const list = await customer.locator("main").innerText();
  check(
    "centre shows each update",
    [`Payment received: ${ref}`, "Bookings", "Payments", "Messages"].every((t) => list.includes(t)),
    list.slice(0, 600),
  );
  check("unread count on the tab", list.includes("Unread (3)"), list.slice(0, 300));
  await shot(customer, "01-customer-notifications");
  await customer.getByRole("link", { name: "Payments", exact: true }).click();
  await customer.waitForURL(/category=payment/);
  const filtered = await customer.locator("main ul").last().innerText();
  check(
    "category filter shows only payments",
    filtered.includes(`Payment received: ${ref}`) &&
      !filtered.includes("New message") &&
      !filtered.includes("Booking accepted"),
    filtered,
  );
  await customer.goto(base + "/notifications");
  await customer.getByRole("link", { name: new RegExp(`Payment received: ${ref}`) }).click();
  await customer.waitForURL(new RegExp(`/account/bookings/${id}$`), { timeout: 15000 });
  check("opening a notification goes to its booking", true);
  check("and marks only that one read", unread(customerId) === "2");
  await customer.goto(base + "/notifications?view=unread");
  check(
    "unread view hides read ones",
    !(await customer.locator("main").innerText()).includes(`Payment received: ${ref}`),
  );
  await customer.getByRole("link", { name: /New message from Lush/ }).click();
  await customer.waitForURL(new RegExp(`/account/messages/${conv}`), { timeout: 15000 });
  check("a message notification opens the chat", true);
  await customer.goto(base + "/notifications");
  await customer.getByRole("button", { name: "Mark all read" }).click();
  check(
    "mark all read",
    (await sees(customer, "Unread", 5000)) && (await badgeIs(customer, "none")) && unread(customerId) === "0",
  );

  // ---- 6. Someone else's notification can't be opened
  const ownersNote = sql(
    `select id from notifications where user_id='${ownerId}' and read_at is null limit 1`,
  );
  await customer.goto(`${base}/notifications/go/${ownersNote}`);
  await customer.waitForURL(/\/notifications$/, { timeout: 15000 });
  check(
    "another person's notification is not opened or marked",
    sql(`select read_at is null from notifications where id='${ownersNote}'`) === "t",
  );

  // ---- 7. Reminder, completion, review request
  sql(
    `update bookings set scheduled_start=now()+interval '3 hours', scheduled_end=now()+interval '5 hours' where id='${id}'`,
  );
  sql(`select queue_scheduled_notifications()`);
  check(
    "reminder to both sides",
    sql(`select count(*) from notifications where type='booking.reminder' and data->>'bookingId'='${id}'`) ===
      "2",
  );
  check("reminder reaches the bell live", await badgeIs(customer, "1", 20000));
  await owner.goto(`${base}/business/bookings/${id}`);
  await owner.getByRole("button", { name: "Mark as started" }).click();
  await sees(owner, "Job started");
  await owner.getByRole("button", { name: "Mark as completed" }).click();
  await sees(owner, "Job completed");
  check(
    "service completion notifies the customer",
    sql(
      `select count(*) from notifications where user_id='${customerId}' and type='booking.completed' and data->>'bookingId'='${id}'`,
    ) === "1",
  );
  sql(`update bookings set completed_at=now()-interval '2 hours' where id='${id}'`);
  sql(`select queue_scheduled_notifications()`);
  await customer.goto(base + "/notifications");
  await customer.getByRole("link", { name: /How did Lush Events/ }).click();
  await customer.waitForURL(new RegExp(`/account/bookings/${id}/review`), { timeout: 15000 });
  check("review request opens the review form", true);
  sql(`select queue_scheduled_notifications()`);
  check(
    "review request sent once",
    sql(`select count(*) from notifications where type='review.request' and data->>'bookingId'='${id}'`) ===
      "1",
  );

  // ---- 8. Dispute and verification updates
  const admin = await as("admin@demo.ng");
  const dispute = sql(
    `select d.id from disputes d join bookings bk on bk.id=d.booking_id where bk.customer_id='${EMEKA}' and d.status='open' limit 1`,
  );
  await admin.goto(`${adminBase}/disputes/${dispute}`);
  await admin.getByRole("button", { name: "Start review" }).click();
  await sees(admin, "Marked as under review.");
  check(
    "dispute under review notifies both sides",
    sql(
      `select count(*) from notifications where type='dispute.under_review' and data->>'bookingId'=(select booking_id::text from disputes where id='${dispute}')`,
    ) === "2",
  );
  const emeka = await as("emeka@demo.ng");
  await emeka.goto(base + "/notifications");
  await emeka
    .getByRole("link", { name: /under review/ })
    .first()
    .click();
  await emeka.waitForURL(/\/dispute$/, { timeout: 15000 });
  check("dispute update opens the dispute", true);

  // A rejected registration with every step done, so its owner can resubmit it.
  const pixelsBiz = sql(`select id from businesses where slug='pending-pixels'`);
  sql(
    `update businesses set status='rejected', status_reason='Blurry ID', logo_path='${pixelsBiz}/logo.png' where id='${pixelsBiz}'`,
  );
  sql(
    `insert into business_portfolio (business_id, media_type, storage_path) values ('${pixelsBiz}', 'image', '${pixelsBiz}/work.png')`,
  );
  sql(
    `insert into business_verifications (business_id, submitted_by, document_type, document_path) select id, owner_id, 'cac_certificate', id || '/cac.pdf' from businesses where id='${pixelsBiz}'`,
  );
  const pixels = await as("pixels@demo.ng");
  await pixels.goto(base + "/business");
  await pixels.getByRole("button", { name: /Resubmit for review|Submit for review/ }).click();
  await pixels.waitForURL(/submitted=1/, { timeout: 15000 });
  check(
    "admins are told about a new registration",
    sql(
      `select count(*) from notifications n join users u on u.id=n.user_id where u.role='admin' and n.type='business.submitted' and n.data->>'businessId'='${pixelsBiz}'`,
    ) === "1",
  );

  // ---- 9. Admin: private, inside the dashboard
  const home = await (await admin.request.get(base + "/")).text();
  check("site header has no admin link, even for admins", !home.includes(slug));
  await admin.goto(base + "/");
  await admin.getByRole("link", { name: /^Notifications/ }).click();
  await admin.waitForURL(new RegExp(`/${slug}/notifications`), { timeout: 15000 });
  check(
    "admin bell opens the admin notification centre",
    await sees(admin, "New registration: Pending Pixels"),
  );
  await shot(admin, "03-admin-notifications");
  await admin.getByRole("link", { name: /New registration: Pending Pixels/ }).click();
  await admin.waitForURL(new RegExp(`/${slug}/businesses/${pixelsBiz}`), { timeout: 15000 });
  check("admin notification opens the business review page", true);
  const visitor = await browser.newPage();
  const resp = await visitor.goto(`${base}/admin/notifications`);
  check("the internal admin path stays hidden", resp.status() === 404);
  await visitor.close();

  // ---- 10. Other channels are off; the dispatcher is locked
  check(
    "nothing queued for email/SMS/push while off",
    sql(`select count(*) from notification_deliveries`) === "0",
  );
  const dispatch = await fetch(base + "/api/notifications/dispatch", { method: "POST" });
  check("dispatcher is off without CRON_SECRET", dispatch.status === 404);

  // ---- 11. Phone
  const phone = await as("customer@demo.ng", { width: 390, height: 844 });
  sql(`update notifications set read_at=now() where user_id='${customerId}'`);
  sql(`update notifications set read_at=null where user_id='${customerId}' and type='booking.reminder'`);
  await phone.goto(base + "/notifications");
  check("bell visible on phone", await badgeIs(phone, "1"));
  check(
    "no horizontal scroll on phone",
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  await shot(phone, "02-mobile-notifications");

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  results.push(`ERROR ${e.message.split("\n").join(" | ")}`);
} finally {
  await browser.close();
  console.log(results.join("\n"));
  console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
}
