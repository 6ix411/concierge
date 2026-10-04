import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/customer`;
execSync(`mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
const shot = (p, name) => p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();
const consoleErrors = [];
p.on("pageerror", (e) => consoleErrors.push(e.message));

try {
  // Home and concierge
  await p.goto(base + "/");
  check("home headline", (await p.locator("h1").innerText()).includes("Tell us what you need"));
  await shot(p, "01-home");
  await p
    .locator("#concierge-query")
    .fill("I need a wedding decorator in Lekki for 300 guests with a ₦1.5m budget.");
  await p.getByRole("button", { name: "Find My Provider" }).click();
  await p.waitForURL(/\/concierge\?/);
  await p.waitForLoadState("networkidle");
  const concierge = await p.locator("main").innerText();
  check("concierge finds Lush", concierge.includes("Lush Events"));
  check("concierge hides unverified", !concierge.includes("Unverified Decor Hub"));
  await shot(p, "02-concierge");

  // Search, services, compare, profile
  await p.goto(base + "/search?q=wedding+decor&location=Lekki");
  await p
    .getByText("Lush Events")
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  const search = await p.locator("main").innerText();
  check("search finds Lush", search.includes("Lush Events"));
  check("search hides unverified", !search.includes("Unverified"));
  await shot(p, "03-search");
  await p.goto(base + "/services");
  await shot(p, "04-services");
  const slugs = sql(
    "select string_agg(id::text, ',') from (select id from businesses where status='approved' order by rating_avg desc limit 2) x",
  );
  await p.goto(base + "/compare?ids=" + slugs);
  await shot(p, "05-compare");
  await p.goto(base + "/businesses/lush-events-decor");
  check("profile renders", (await p.locator("h1").innerText()).includes("Lush"));
  await shot(p, "06-profile");
  const unverified = await (await p.request.get(base + "/businesses/unverified-decor-hub")).text();
  check(
    "unverified profile is not found and noindex",
    unverified.includes("Business not found") && /noindex/.test(unverified),
  );

  // Booking requires sign-in
  await p.goto(base + "/book/lush-events-decor");
  check("booking redirects to sign-in", p.url().includes("/sign-in"), p.url());
  await p.getByLabel("Email").fill("customer@demo.ng");
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(/\/book\/lush-events-decor|\/account/, { timeout: 15000 });
  if (!p.url().includes("/book/")) await p.goto(base + "/book/lush-events-decor");

  await p.getByLabel(/Classic Wedding Decor/).check();
  const d = new Date(Date.now() + 14 * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  await p.getByLabel("Date").fill(d.toISOString().slice(0, 10));
  await p.getByLabel("Start time").fill("10:00");
  await p.getByLabel("Address").fill("12 Admiralty Way");
  await p.getByLabel("Area").fill("Lekki");
  await shot(p, "07-book");
  await p.getByRole("button", { name: "Send booking request" }).click();
  await p.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, { timeout: 15000 });
  const bookingId = p.url().match(/bookings\/([0-9a-f-]+)/)[1];
  check("booking created", sql(`select status from bookings where id='${bookingId}'`) === "pending_provider");
  check("price from server", sql(`select total_minor from bookings where id='${bookingId}'`) === "120000000");
  await shot(p, "08-booking-sent");

  // Business accepts (Stage 4 UI); customer pays with the mock provider
  sql(`update bookings set status='accepted' where id='${bookingId}'`);
  await p.goto(`${base}/checkout/${bookingId}`);
  await shot(p, "09-checkout");
  await p.getByRole("button", { name: /Pay .* securely/ }).click();
  await p.getByText("Payment received").waitFor({ timeout: 15000 });
  check(
    "payment confirms booking",
    sql(`select status from bookings where id='${bookingId}'`) === "confirmed",
  );
  check("payment recorded", sql(`select status from payments where booking_id='${bookingId}'`) === "success");
  await shot(p, "10-paid");
  const replay = await p.request.get(
    `${base}/api/payments/callback?reference=${sql(`select reference from payments where booking_id='${bookingId}'`)}`,
    { maxRedirects: 0 },
  );
  check(
    "callback replay is harmless",
    sql(`select count(*) from payments where booking_id='${bookingId}' and status='success'`) === "1",
    String(replay.status()),
  );

  // Chat: customer sends, business message arrives live
  const conversationId = sql(`select id from conversations where booking_id='${bookingId}'`);
  check("chat opened on confirmation", conversationId.length > 0);
  await p.goto(`${base}/account/messages/${conversationId}`);
  await p.locator("#chat-body").fill("Hello, can we use white and gold?");
  await p.getByRole("button", { name: "Send" }).click();
  await p.getByText("Hello, can we use white and gold?").waitFor({ timeout: 10000 });
  check(
    "customer message stored",
    sql(`select count(*) from messages where conversation_id='${conversationId}'`) === "1",
  );
  const ownerId = sql("select id from users where email='owner@demo.ng'");
  await p.waitForTimeout(1500);
  sql(
    `insert into messages (conversation_id, sender_id, body) values ('${conversationId}', '${ownerId}', 'Yes, white and gold works well.')`,
  );
  const live = await p
    .getByText("Yes, white and gold works well.")
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("business reply arrives in real time", live);
  check(
    "no AI messages in chat",
    sql(
      `select count(*) from messages where conversation_id='${conversationId}' and sender_id not in (select customer_id from bookings where id='${bookingId}' union select '${ownerId}')`,
    ) === "0",
  );
  await shot(p, "11-chat");

  // Complete and review
  sql(`update bookings set status='in_progress' where id='${bookingId}'`);
  sql(`update bookings set status='completed' where id='${bookingId}'`);
  await p.goto(`${base}/account/bookings/${bookingId}/review`);
  await p.getByRole("button", { name: /^5 stars/ }).click();
  await p.locator("#comment").fill("Beautiful work, on time.");
  await p.getByRole("button", { name: "Post review" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/review"), { timeout: 15000 });
  check("review saved", sql(`select rating from reviews where booking_id='${bookingId}'`) === "5");
  await p.goto(`${base}/account/reviews`);
  await shot(p, "12-reviews");

  // Lists and settings
  await p.goto(`${base}/account/bookings`);
  await shot(p, "13-bookings");
  await p.goto(`${base}/account/messages`);
  await shot(p, "14-messages");
  await p.goto(`${base}/account/settings`);
  await p.getByLabel("Phone").fill("+2348012345678");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.waitForTimeout(1500);
  check("settings saved", sql("select phone from users where email='customer@demo.ng'") === "+2348012345678");
  await shot(p, "15-settings");
} catch (error) {
  results.push("ERROR " + error.message.split("\n")[0]);
  await shot(p, "zz-error");
}
check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
console.log(results.join("\n"));
await browser.close();
