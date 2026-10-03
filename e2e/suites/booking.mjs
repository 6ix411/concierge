import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const adminBase = base + `/${process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e"}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-9`;
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
const history = (id) =>
  sql(
    `select coalesce(from_status::text,'-')||'>'||to_status||':'||actor_role from booking_events where booking_id='${id}' and event='status_changed' order by created_at`,
  ).split("\n");

const browser = await chromium.launch();
const errors = [];
async function as(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
const tuesday = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

try {
  const customer = await as("customer@demo.ng");
  const owner = await as("owner@demo.ng");
  const admin = await as("admin@demo.ng");

  // ---- 1. The booking form: business, service, package, date, time, location, add-ons, requirements
  await customer.goto(base + "/book/lush-events-decor");
  await sees(customer, "Booking with");
  const form = await customer.locator("form").innerText();
  for (const section of [
    "Service",
    "Package",
    "Date and time",
    "Location",
    "Add-ons",
    "Additional requirements",
  ])
    check(`form has ${section}`, form.includes(section), form.slice(0, 300));
  check(
    "form shows service areas",
    form.includes("Works in") && form.includes("Lekki, Lagos ·") && !form.includes("Lagos, Lagos"),
    form,
  );
  await customer.getByRole("button", { name: "Send booking request" }).click();
  check("needs a service or package", await sees(customer, "Choose a service or a package."));

  await customer.getByLabel(/Classic Wedding Decor/).check();
  await customer.getByLabel(/Fog machine/).check();
  await customer.getByLabel("Date").fill(tuesday(14));
  await customer.getByLabel("Start time").fill("10:00");
  await customer.getByLabel("Address").fill("12 Admiralty Way");
  await customer.getByLabel("Area").fill("Lekki");
  await customer.getByLabel("City").fill("Lagos");
  await customer.getByLabel("State").fill("Ogun");
  await customer.getByLabel(/Number of guests/).fill("250");
  await customer.getByLabel(/Anything else/).fill("Gold and white theme. Setup must finish by 9am.");
  const summary = await customer.locator("form > div").last().innerText();
  check(
    "live summary lists package and add-on",
    summary.includes("Classic Wedding Decor") &&
      summary.includes("Fog machine") &&
      summary.includes("₦1,350,000"),
    summary,
  );
  await shot(customer, "desktop-01-booking-form");
  await customer.getByRole("button", { name: "Send booking request" }).click();
  check("refuses a state the business doesn't serve", await sees(customer, "works in Lagos only"));
  await customer.getByLabel("State").fill("Lagos");
  await customer.getByRole("button", { name: "Send booking request" }).click();
  await customer.waitForURL(/\/account\/bookings\/[0-9a-f-]+\?sent=1/, {
    timeout: 15000,
    waitUntil: "commit",
  });
  const id = customer.url().match(/bookings\/([0-9a-f-]+)/)[1];

  const row = sql(
    `select status||'|'||total_minor||'|'||area||'|'||city||'|'||state||'|'||guests||'|'||needs_quote||'|'||reference from bookings where id='${id}'`,
  ).split("|");
  check("booking goes to pending_provider", row[0] === "pending_provider", row.join("|"));
  check("price from the database (package + add-on)", row[1] === "135000000", row[1]);
  check("location and guests stored", row.slice(2, 6).join("|") === "Lekki|Lagos|Lagos|250", row.join("|"));
  check("unique booking ID", /^BK-[0-9A-F]{10}$/.test(row[7]), row[7]);
  check(
    "items keep package and add-on",
    sql(`select string_agg(kind, ',' order by kind) from booking_items where booking_id='${id}'`) ===
      "addon,package",
  );
  check(
    "history starts requested → pending provider",
    history(id).join(",") === "requested>pending_provider:system",
    history(id).join(","),
  );
  check(
    "created by the customer",
    sql(`select actor_role from booking_events where booking_id='${id}' and event='created'`) === "customer",
  );
  await sees(customer, "Sent to the business");
  const page1 = await customer.locator("main").innerText();
  check("customer sees waiting for business", page1.includes("Waiting for business"));
  check("customer sees progress", page1.includes("With the business") && page1.includes("Reviewed"));
  check(
    "customer sees history",
    page1.includes("Booking requested") && page1.includes("Sent to the business"),
  );
  check("customer sees package and add-on tags", page1.includes("Package") && page1.includes("Add-on"));
  check(
    "customer sees guests and location",
    page1.includes("250 guests") && page1.includes("12 Admiralty Way, Lekki, Lagos"),
  );
  check("customer sees requirements", page1.includes("Gold and white theme"));
  await shot(customer, "desktop-02-booking-requested");

  // ---- 2. Business accepts
  await owner.goto(`${base}/business/bookings/${id}`);
  check("business sees needs your answer", await sees(owner, "Needs your answer"));
  check(
    "business sees requirements and guests",
    (await owner.locator("main").innerText()).includes("250 guests"),
  );
  await owner.getByRole("button", { name: "Accept booking" }).click();
  await sees(owner, "Accepted by the business");
  check("accepted", sql(`select status from bookings where id='${id}'`) === "accepted");

  // ---- 3. Customer pays: accepted → payment_pending → confirmed (verified on the server)
  await customer.goto(`${base}/checkout/${id}`);
  await customer.getByRole("button", { name: /Pay .* securely/ }).click();
  await customer.getByText("Payment received").first().waitFor({ timeout: 20000 });
  check(
    "address bar shows the booking after payment",
    /\/account\/bookings\/[0-9a-f-]+\?payment=success/.test(customer.url()),
    customer.url(),
  );
  check(
    "confirmed after verified payment",
    sql(`select status from bookings where id='${id}'`) === "confirmed",
  );
  const h = history(id).join(",");
  check(
    "payment pending recorded",
    h.includes("accepted>payment_pending:customer") && h.includes("payment_pending>confirmed:system"),
    h,
  );

  // ---- 4. Business starts and completes the job
  await owner.goto(`${base}/business/bookings/${id}`);
  await owner.getByRole("button", { name: "Mark as started" }).click();
  await sees(owner, "Job started");
  await owner.getByRole("button", { name: "Mark as completed" }).click();
  await sees(owner, "Job completed");
  check("completed", sql(`select status from bookings where id='${id}'`) === "completed");
  await shot(owner, "desktop-05-business-booking");

  // ---- 5. Customer reviews → reviewed
  await customer.goto(`${base}/account/bookings/${id}/review`);
  await customer.getByRole("button", { name: /5 stars/ }).click();
  await customer.getByRole("button", { name: "Post review" }).click();
  await customer.waitForURL(/reviewed=1/, { timeout: 15000, waitUntil: "commit" });
  await sees(customer, "Review left");
  check("reviewed", sql(`select status from bookings where id='${id}'`) === "reviewed");
  check(
    "full history stored",
    history(id).join(",") ===
      "requested>pending_provider:system,pending_provider>accepted:business,accepted>payment_pending:customer,payment_pending>confirmed:system,confirmed>in_progress:business,in_progress>completed:business,completed>reviewed:customer",
    history(id).join(","),
  );
  const page2 = await customer.locator("main").innerText();
  check(
    "customer history shows every step",
    [
      "Accepted by the business",
      "Payment started",
      "Paid and confirmed",
      "Job started",
      "Job completed",
      "Review left",
    ].every((t) => page2.includes(t)),
  );
  check(
    "review counts as a completed job on the profile",
    sql(
      `select completed_bookings from get_business_stats((select id from businesses where slug='lush-events-decor'))`,
    ) === "3",
  );
  await shot(customer, "desktop-03-booking-reviewed");

  // ---- 6. Admin sees the history
  await admin.goto(`${adminBase}/bookings/${id}`);
  check("admin sees history", await sees(admin, "Review left"));
  await shot(admin, "desktop-06-admin-history");

  // ---- 7. Decline
  const made = () =>
    sql(
      `select id from create_booking(jsonb_build_object('customer_id','a0000000-0000-0000-0000-000000000001','business_id',(select id from businesses where slug='lush-events-decor'),'scheduled_start',now()+interval '20 days','scheduled_end',now()+interval '20 days 3 hours','address_line','5 Bourdillon','area','Ikoyi','city','Lagos','state','Lagos','subtotal_minor',250000000,'platform_fee_minor',0,'total_minor',250000000,'commission_rate_bps',1000), '[]'::jsonb)`,
    );
  const declineId = made();
  await owner.goto(`${base}/business/bookings/${declineId}`);
  await owner.getByRole("button", { name: "Decline", exact: true }).click();
  await owner.getByLabel(/Why can/).fill("Fully booked that weekend.");
  await owner.getByRole("button", { name: "Decline booking" }).click();
  await sees(owner, "Fully booked that weekend.");
  check("declined", sql(`select status from bookings where id='${declineId}'`) === "declined");
  check(
    "decline reason in history",
    sql(`select note from booking_events where booking_id='${declineId}' and to_status='declined'`) ===
      "Fully booked that weekend.",
  );
  await customer.goto(`${base}/account/bookings/${declineId}`);
  check("customer sees declined", await sees(customer, "The business declined this booking."));

  // ---- 8. Paid booking cancelled → refund due → admin records refund → refunded
  const refundId = made();
  sql(
    `update bookings set status='accepted', change_actor_id=(select owner_id from businesses where slug='lush-events-decor') where id='${refundId}'`,
  );
  await customer.goto(`${base}/checkout/${refundId}`);
  await customer.getByRole("button", { name: /Pay .* securely/ }).click();
  await customer.getByText("Payment received").first().waitFor({ timeout: 20000 });
  await sees(customer, "Paid and confirmed");
  await customer.getByRole("button", { name: "Cancel booking" }).click();
  await customer.getByRole("button", { name: "Yes, cancel" }).click();
  await sees(customer, "Booking cancelled.");
  check("paid booking cancelled", sql(`select status from bookings where id='${refundId}'`) === "cancelled");
  await customer.goto(`${base}/account/bookings/${refundId}`);
  check("customer told refund is due", await sees(customer, "is due back to you"));
  await admin.goto(`${adminBase}/bookings?status=refunds`);
  const ref = sql(`select reference from bookings where id='${refundId}'`);
  check("admin refunds-due list", await sees(admin, ref));
  await admin.goto(`${adminBase}/bookings/${refundId}`);
  await admin.getByRole("button", { name: /Refund .* to the customer/ }).click();
  await admin.getByLabel(/Note/).fill("Customer cancelled after paying");
  await admin
    .getByRole("button", { name: /Refund .* to the customer/ })
    .last()
    .click();
  await sees(admin, "refunded to the customer");
  check("refunded", sql(`select status from bookings where id='${refundId}'`) === "refunded");
  check(
    "payment marked refunded",
    sql(`select status||':'||(refunded_minor=amount_minor) from payments where booking_id='${refundId}'`) ===
      "refunded:true",
  );
  check(
    "refund in history",
    sql(
      `select actor_role||':'||note from booking_events where booking_id='${refundId}' and to_status='refunded'`,
    ).startsWith("admin:₦2,500,000 refunded"),
  );
  await admin.goto(`${adminBase}/bookings/${refundId}`);
  await shot(admin, "desktop-07-admin-refunded");

  // ---- 9. Quote request
  await customer.goto(base + "/book/lush-events-decor");
  await customer.getByLabel(/Custom Event Styling/).check();
  await customer.getByLabel("Date").fill(tuesday(21));
  await customer.getByLabel("Start time").fill("11:00");
  await customer.getByLabel("Address").fill("3 Ozumba Mbadiwe");
  await customer.getByLabel("Area").fill("Victoria Island");
  await customer.getByLabel("City").fill("Lagos");
  await customer.getByLabel("State").fill("Lagos");
  await customer.getByRole("button", { name: "Send quote request" }).click();
  await customer.waitForURL(/\?sent=1/, { timeout: 15000, waitUntil: "commit" });
  const quoteId = customer.url().match(/bookings\/([0-9a-f-]+)/)[1];
  check(
    "quote request waits for the business",
    sql(`select status||':'||needs_quote from bookings where id='${quoteId}'`) === "pending_provider:true",
  );
  await owner.goto(`${base}/business/bookings/${quoteId}`);
  check(
    "business asked for a price",
    (await sees(owner, "Send quote")) &&
      (await owner.getByRole("button", { name: "Accept booking" }).count()) === 0,
  );

  // ---- 10. Mobile
  const mobile = await as("customer@demo.ng", { width: 390, height: 844 });
  await mobile.goto(base + "/book/lush-events-decor");
  await sees(mobile, "Booking with");
  await shot(mobile, "mobile-01-booking-form");
  await mobile.goto(`${base}/account/bookings/${id}`);
  await sees(mobile, "Review left");
  await shot(mobile, "mobile-03-booking-reviewed");
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no horizontal scroll on mobile", !overflow);
} catch (error) {
  check("script ran", false, String(error).slice(0, 500));
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(results.join("\n"));
console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
