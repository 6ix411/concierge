// Stage 20: what happens when things go wrong. Empty, loading and error states, dropped
// connections, double taps, and a booking paid for twice.
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-20`;
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
const settle = (p) => p.waitForLoadState("networkidle").catch(() => {});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tuesday = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const OFFLINE = "We couldn’t reach Concierge";
const CRASH = "Something went wrong";

const browser = await chromium.launch();
const errors = [];
async function as(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  if (email) {
    await p.goto(base + "/sign-in");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Password").fill("Password123");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  }
  return p;
}
const customerId = sql(`select id from users where email='customer@demo.ng'`);
const bookingsOf = (where = "true") =>
  count(
    `select count(*) from bookings b join businesses z on z.id=b.business_id where b.customer_id='${customerId}' and z.slug='frames-by-kemi' and ${where}`,
  );

async function fillBooking(p, date, time = "10:00") {
  await p.goto(`${base}/book/frames-by-kemi`);
  await settle(p);
  await p.getByText("Family Portrait Session").click();
  await p.getByLabel("Date").fill(date);
  await p.getByLabel("Start time").fill(time);
  await p.getByLabel("Address").fill("5 Adeola Odeku Street");
  await p.getByLabel("Area").fill("Victoria Island");
}

try {
  const customer = await as("customer@demo.ng");
  const kemi = await as("kemi@demo.ng");

  // ---- 1. Empty states: a new customer sees what to do next, never a blank page
  for (const [path, text] of [
    ["/account/bookings", "No upcoming bookings"],
    ["/account/bookings?view=past", "No past bookings"],
    ["/account/messages", "No conversations yet"],
    ["/account/reviews", "No reviews yet"],
  ]) {
    await customer.goto(base + path);
    check(`empty state on ${path}`, await sees(customer, text));
  }
  await customer.goto(base + "/account/bookings");
  check(
    "empty bookings point to the concierge",
    (await customer.locator("main").getByRole("link", { name: "Find My Provider" }).getAttribute("href")) ===
      "/concierge",
  );
  await customer.goto(`${base}/search?q=zzqxv+unicorn+grooming`);
  check(
    "a search with no results says what to try",
    await sees(customer, "No verified businesses match yet"),
  );
  check(
    "and offers the concierge",
    await customer.getByRole("link", { name: "Ask the concierge" }).isVisible(),
  );
  await kemi.goto(`${base}/business`);
  check("a business with no requests is told what will appear", await sees(kemi, "No new requests"));
  await shot(customer, "01-empty-search");

  // ---- 2. Error states: friendly pages and messages, nothing technical
  await customer.goto(`${base}/businesses/no-such-business`);
  check("unknown business shows Page not found", await sees(customer, "Page not found"));
  await customer.goto(`${base}/account/bookings/00000000-0000-4000-8000-000000000000`);
  check("unknown booking shows Page not found", await sees(customer, "Page not found"));
  const others = sql(`select id from bookings where customer_id <> '${customerId}' limit 1`);
  await customer.goto(`${base}/account/bookings/${others}`);
  check("someone else's booking shows Page not found", await sees(customer, "Page not found"));
  await customer.goto(`${base}/checkout/${others}`);
  check("and so does paying for it", await sees(customer, "Page not found"));
  const api = await fetch(`${base}/api/payments/callback?reference=nonsense`, { redirect: "manual" });
  check(
    "a bad payment link goes back to bookings",
    (api.headers.get("location") ?? "").includes("/account/bookings?payment=invalid"),
  );
  const signin = await as(null);
  await signin.goto(`${base}/sign-in`);
  await signin.getByLabel("Email").fill("customer@demo.ng");
  await signin.getByLabel("Password").fill("wrong-password");
  await signin.getByRole("button", { name: "Sign in" }).click();
  check("a wrong password gets a plain message", await sees(signin, /incorrect|didn.t match|wrong/i));
  await customer.goto(`${base}/book/frames-by-kemi`);
  await settle(customer);
  await customer.getByRole("button", { name: "Send booking request" }).click();
  check(
    "a booking with nothing filled in points at the fields",
    (await customer.locator('[aria-invalid="true"], :invalid').count()) > 0,
  );
  check("no crash pages so far", !(await customer.getByText(CRASH).isVisible()));

  // ---- 3. Loading states: slow requests show progress and can't be sent twice
  const slow = await as(null);
  await slow.route("**/*", async (route) => {
    if (route.request().method() === "POST") await wait(2000);
    await route.continue().catch(() => {});
  });
  await slow.goto(`${base}/sign-in`);
  await settle(slow);
  await slow.getByLabel("Email").fill("emeka@demo.ng");
  await slow.getByLabel("Password").fill("Password123");
  const button = slow.getByRole("button", { name: "Sign in" });
  await button.click();
  await wait(300);
  check(
    "the button shows it is working",
    (await button.getAttribute("aria-busy")) === "true" && (await button.isDisabled()),
  );
  await slow.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  await slow.goto(`${base}/concierge`);
  await settle(slow);
  await slow.locator("#concierge-message").fill("A photographer in Lekki");
  await slow.locator("#concierge-message").press("Enter");
  check("the concierge shows it is searching", await sees(slow, "Checking verified providers", 3000));
  check("and the answer arrives", await sees(slow, "Frames by Kemi", 20000));

  // ---- 4. Dropped connections: a clear message, nothing lost, nothing sent twice
  const date = tuesday(14);
  await fillBooking(customer, date);
  await customer.context().setOffline(true);
  await customer.getByRole("button", { name: "Send booking request" }).click();
  check("booking offline: says the connection dropped", await sees(customer, OFFLINE));
  check("booking offline: no crash page", !(await customer.getByText(CRASH).isVisible()));
  check(
    "booking offline: what was typed is still there",
    (await customer.getByLabel("Address").inputValue()) === "5 Adeola Odeku Street",
  );
  check("booking offline: nothing was booked", bookingsOf() === 0);
  await shot(customer, "02-booking-offline");
  await customer.context().setOffline(false);
  await customer.getByRole("button", { name: "Send booking request" }).click();
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  check("back online, the same form books once", bookingsOf() === 1);

  // The request reaches the server but the answer never comes back; sending again must not book twice.
  await fillBooking(customer, tuesday(21));
  let dropped = false;
  await customer.route("**/book/frames-by-kemi", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch().catch(() => {}); // the server does the work...
      return route.abort("connectionreset"); // ...but the phone never hears back
    }
    return route.continue();
  });
  await customer.getByRole("button", { name: "Send booking request" }).click();
  check("lost reply: the customer is told to try again", await sees(customer, OFFLINE));
  check("lost reply: the booking was made once", bookingsOf() === 2, String(bookingsOf()));
  await customer.getByRole("button", { name: "Send booking request" }).click();
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  check(
    "lost reply: trying again opens that booking instead of making another",
    bookingsOf() === 2,
    String(bookingsOf()),
  );
  await customer.unroute("**/book/frames-by-kemi");
  check(
    "the business was told once",
    count(
      `select count(*) from notifications n join users u on u.id=n.user_id where u.email='kemi@demo.ng' and n.type='booking.requested'`,
    ) === 2,
  );

  // Concierge and chat keep what was typed when the connection drops.
  await customer.goto(`${base}/concierge`);
  await settle(customer);
  await customer.context().setOffline(true);
  await customer.locator("#concierge-message").fill("A caterer in Ikeja for 50 guests");
  await customer.locator("#concierge-message").press("Enter");
  check("concierge offline: says the connection dropped", await sees(customer, OFFLINE));
  check(
    "concierge offline: the message is back in the box",
    (await customer.locator("#concierge-message").inputValue()) === "A caterer in Ikeja for 50 guests",
  );
  await customer.context().setOffline(false);

  // ---- 5. The same slot twice
  await fillBooking(customer, date);
  await customer.getByRole("button", { name: "Send booking request" }).click();
  check(
    "a second booking for the same time is refused",
    await sees(customer, "You already have a booking with Frames by Kemi at that time"),
  );
  check("still one booking at that time", bookingsOf(`b.scheduled_start::date = '${date}'`) === 1);
  // Double tap: two submits back to back make one booking.
  await fillBooking(customer, tuesday(28), "14:00");
  await customer.evaluate(() => {
    const form = document.querySelector("form:has(input[name=requestKey])");
    form.requestSubmit();
    form.requestSubmit();
  });
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  await wait(1000);
  check("a double tap books once", bookingsOf() === 3, String(bookingsOf()));

  // ---- 6. Paying twice
  const id = sql(
    `select b.id from bookings b join businesses z on z.id=b.business_id where b.customer_id='${customerId}' and z.slug='frames-by-kemi' and b.scheduled_start::date='${date}'`,
  );
  await kemi.goto(`${base}/business/bookings/${id}`);
  await kemi.getByRole("button", { name: "Accept booking" }).click();
  await sees(kemi, "Accepted by the business");
  // Tab A starts paying but never comes back from the payment page.
  const tabA = await customer.context().newPage();
  await tabA.route("**/api/payments/callback**", (route) => route.abort());
  await tabA.goto(`${base}/checkout/${id}`);
  await tabA.getByRole("button", { name: /Pay .* securely/ }).click();
  await wait(2000);
  const payments = () => count(`select count(*) from payments where booking_id='${id}'`);
  check("one checkout started", payments() === 1, String(payments()));
  // Tab B taps Pay too: it goes back to the open checkout instead of starting another charge.
  const tabB = await customer.context().newPage();
  await tabB.route("**/api/payments/callback**", (route) => route.abort());
  await tabB.goto(`${base}/checkout/${id}`);
  await tabB.getByRole("button", { name: /Pay .* securely/ }).click();
  await wait(2000);
  check("a second tap reuses the open checkout", payments() === 1, String(payments()));
  // An hour later the first checkout has expired, so a new one starts; then both get paid.
  sql(`update payments set created_at = now() - interval '1 hour' where booking_id='${id}'`);
  await tabB.goto(`${base}/checkout/${id}`);
  await tabB.getByRole("button", { name: /Pay .* securely/ }).click();
  await wait(2000);
  check("an expired checkout starts a new one", payments() === 2, String(payments()));
  const [first, second] = sql(
    `select reference from payments where booking_id='${id}' order by created_at`,
  ).split("\n");
  await customer.goto(`${base}/api/payments/callback?reference=${first}`);
  check("the first payment confirms the booking", await sees(customer, "Payment received"));
  await customer.goto(`${base}/api/payments/callback?reference=${second}`);
  await settle(customer);
  check(
    "the second payment is refunded automatically",
    sql(`select status from payments where reference='${second}'`) === "refunded",
    sql(`select status from payments where reference='${second}'`),
  );
  check("the first stays paid", sql(`select status from payments where reference='${first}'`) === "success");
  check(
    "the booking is confirmed once",
    sql(`select status from bookings where id='${id}'`) === "confirmed" &&
      count(`select count(*) from booking_events where booking_id='${id}' and to_status='confirmed'`) === 1,
  );
  check(
    "the customer is told",
    count(
      `select count(*) from notifications where user_id='${customerId}' and title='Duplicate payment refunded'`,
    ) === 1,
  );
  check(
    "and it is logged for the team",
    count(`select count(*) from security_events where event='payment.duplicate'`) === 1,
  );
  // The webhook for the second payment arriving later changes nothing.
  const hook = await fetch(`${base}/api/payments/webhook/mock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "charge.success", data: { reference: second } }),
  });
  check("a late webhook for it is accepted", hook.status === 200, String(hook.status));
  check(
    "and refunds nothing twice",
    sql(`select status || ':' || refunded_minor from payments where reference='${second}'`) ===
      `refunded:${sql(`select amount_minor from payments where reference='${second}'`)}`,
  );
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("suite ran", false, error.stack);
}
await browser.close();
console.log(results.join("\n"));
console.log(
  `${results.filter((r) => r.startsWith("PASS")).length} passed, ${results.filter((r) => r.startsWith("FAIL")).length} failed`,
);
