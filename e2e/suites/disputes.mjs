import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const adminBase = base + `/${process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e"}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-13`;
const files = new URL("../fixtures", import.meta.url).pathname;
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
const EMEKA = "a0000000-0000-0000-0000-000000000003";
const ROYAL = "b0000000-0000-0000-0000-000000000002";

async function openDispute(p, bookingId, { code, summary, description, attach = [] }) {
  await p.goto(`${base}/account/bookings/${bookingId}`);
  await p.getByRole("button", { name: "Open a dispute" }).click();
  if (code) await p.getByLabel("What's the problem?").selectOption(code);
  await p.getByLabel("Summary").fill(summary);
  await p.getByLabel("What happened?").fill(description);
  if (attach.length) await p.locator('input[name="files"]').setInputFiles(attach);
  await p.getByRole("button", { name: "Open dispute" }).click();
}

try {
  const booking = sql(
    `select bk.id from bookings bk join businesses b on b.id=bk.business_id where b.slug='royal-touch-decorations' and bk.customer_id='${EMEKA}' and bk.status='completed'`,
  );
  const ref = sql(`select reference from bookings where id='${booking}'`);
  const confirmed = sql(
    `select id from bookings where customer_id='${EMEKA}' and status='confirmed' limit 1`,
  );
  const customer = await as("emeka@demo.ng");
  const business = await as("royal@demo.ng");
  const admin = await as("admin@demo.ng");
  const other = await as("customer@demo.ng");

  // ---- 1. Opening: reason, description and evidence are required/checked
  await openDispute(customer, booking, { summary: "Flowers wilted", description: "Short." });
  check("a reason must be chosen", await sees(customer, "Choose what the problem is."));
  check("a real description is needed", await sees(customer, "Describe what happened, in a few sentences."));
  check(
    "typed text is kept after an error",
    (await customer.getByLabel("Summary").inputValue()) === "Flowers wilted",
  );
  await customer.getByLabel("What's the problem?").selectOption("poor_quality");
  await customer
    .getByLabel("What happened?")
    .fill("Half the flowers had wilted before guests arrived and two arches were missing.");
  await customer.locator('input[name="files"]').setInputFiles(`${files}/fake.jpg`);
  await customer.getByRole("button", { name: "Open dispute" }).click();
  check("a fake file is refused by the server", await sees(customer, "fake.jpg isn't a photo, video or PDF"));
  check(
    "nothing saved after a refused file",
    sql(`select count(*) from disputes where booking_id='${booking}'`) === "0",
  );
  check(
    "picked files are kept after an error",
    (await customer.getByRole("button", { name: "Remove fake.jpg" }).count()) === 1,
  );
  await customer.getByRole("button", { name: "Remove fake.jpg" }).click();
  await customer
    .locator('input[name="files"]')
    .setInputFiles([`${files}/decor-sample.png`, `${files}/menu.pdf`]);
  await customer.getByRole("button", { name: "Open dispute" }).click();
  await customer.waitForURL(/\/dispute$/, { timeout: 20000 });
  check("opening goes to the dispute page", customer.url().endsWith(`/account/bookings/${booking}/dispute`));
  const dispute = sql(`select id from disputes where booking_id='${booking}'`);

  // ---- 2. The record
  check(
    "captures booking, reason, summary and description",
    sql(
      `select reason_code||'|'||reason||'|'||(description like 'Half the flowers%')||'|'||status from disputes where id='${dispute}'`,
    ) === "poor_quality|Flowers wilted|true|open",
  );
  check(
    "evidence stored privately",
    sql(`select count(*) from dispute_evidence where dispute_id='${dispute}'`) === "2" &&
      sql(
        `select count(*) from storage.objects where bucket_id='dispute-evidence' and name like '${dispute}/%'`,
      ) === "2",
  );
  check("booking moves to disputed", sql(`select status from bookings where id='${booking}'`) === "disputed");
  check(
    "business and admins notified",
    sql(
      `select count(*) from notifications where type='dispute.opened' and user_id in ('${ROYAL}', 'a0000000-0000-0000-0000-0000000000ad')`,
    ) === "2",
  );
  const details = await customer.getByRole("region", { name: "Dispute details" }).innerText();
  check(
    "dispute shows the booking",
    [
      `#${ref}`,
      "Emeka Nwosu",
      "Royal Touch Decorations",
      "White Wedding Reception Decor",
      "Poor quality",
    ].every((t) => details.includes(t)),
    details,
  );
  check("status shown as open", await sees(customer, "The Concierge team has your dispute"));
  check(
    "evidence shown",
    (await customer.locator('[aria-label="Evidence"] img').count()) === 1 &&
      (await sees(customer, "menu.pdf")),
  );
  check("history starts with opening", await sees(customer, "Opened by the customer"));
  await shot(customer, "01-customer-dispute");

  // ---- 3. Business side
  await business.goto(`${base}/business/bookings/${booking}`);
  check("business sees the dispute on the booking", await sees(business, "Dispute · open"));
  await business.getByRole("link", { name: /Open the dispute/ }).click();
  await business.waitForURL(/\/dispute$/);
  check("business sees the customer's description", await sees(business, "Half the flowers had wilted"));
  check(
    "business sees the customer's evidence",
    (await business.locator('[aria-label="Evidence"] img').count()) === 1,
  );
  check(
    "only the opener can withdraw",
    (await business.getByRole("button", { name: "Withdraw the dispute" }).count()) === 0,
  );
  await business
    .getByLabel("Add to the dispute")
    .fill("The flowers were fresh at setup. Here is our walkthrough video from 4pm.");
  await business.locator('input[name="files"]').setInputFiles(`${files}/venue-walkthrough.mp4`);
  await business.getByRole("button", { name: "Send" }).click();
  check("business replies with a video", await sees(business, "Here is our walkthrough video"));
  await sees(business, "Sent.");
  check(
    "message field clears after sending",
    (await business.getByLabel("Add to the dispute").inputValue()) === "",
  );
  check(
    "video saved as evidence on the message",
    sql(
      `select count(*) from dispute_evidence e join dispute_messages m on m.id=e.message_id where e.dispute_id='${dispute}' and e.mime_type='video/mp4'`,
    ) === "1",
  );
  await customer.reload();
  check("customer sees the business's reply", await sees(customer, "Here is our walkthrough video"));
  check("customer sees the video", (await customer.locator("video").count()) >= 1);

  // ---- 4. Outsiders
  await other.goto(`${base}/account/bookings/${booking}/dispute`);
  check(
    "other customers can't open it",
    (await other.locator("body").innerText()).toLowerCase().includes("not found"),
  );

  // ---- 5. Admin
  await admin.goto(`${adminBase}/disputes`);
  check("admin sees it in active disputes", await sees(admin, "Flowers wilted"));
  await admin.getByRole("link", { name: /Flowers wilted/ }).click();
  await admin.waitForURL(/disputes\//);
  check("admin sees all evidence", await sees(admin, "Evidence (3)"));
  await admin.getByLabel("Message").fill("Check the 4pm video against the photo timestamps.");
  await admin.getByLabel("Internal note (admins only)").check();
  await admin.getByRole("button", { name: "Send" }).click();
  check("admin writes an internal note", await sees(admin, "Note saved."));
  await admin.getByLabel("Message").fill("Thanks both. Could the customer share when the photo was taken?");
  await admin.getByRole("button", { name: "Send" }).click();
  check("admin messages both sides", await sees(admin, "Sent to both sides."));
  await business.reload();
  check(
    "parties see the team's message",
    await sees(business, "Could the customer share when the photo was taken?"),
  );
  check("parties never see internal notes", !(await business.getByText("Check the 4pm video").count()));

  await admin.getByRole("button", { name: "Escalate" }).click();
  await admin
    .getByLabel(/Why does it need escalating/)
    .fill("Customer asking for a full refund; needs a senior decision.");
  await admin.getByRole("button", { name: "Escalate" }).click();
  await admin.waitForTimeout(1500);
  check("dispute escalated", sql(`select status from disputes where id='${dispute}'`) === "escalated");
  await customer.reload();
  check("customer sees it's escalated", await sees(customer, "It has gone to a senior member"));
  check("escalation reason stays internal", !(await customer.getByText("needs a senior decision").count()));
  await admin.goto(`${adminBase}/disputes?status=escalated`);
  check("escalated filter", await sees(admin, "Flowers wilted"));
  await admin.goto(`${adminBase}/disputes/${dispute}`);
  await shot(admin, "02-admin-dispute");

  await admin.getByRole("button", { name: "Side with the business" }).click();
  await admin
    .getByLabel("Explain the decision")
    .fill("The video shows the decor complete and fresh at 4pm. The job stands.");
  await admin.getByRole("button", { name: "Side with the business" }).click();
  await admin.waitForTimeout(2000);
  check(
    "dispute resolved",
    sql(`select status||':'||outcome from disputes where id='${dispute}'`) === "resolved:business",
  );
  check(
    "booking back to completed, payout released",
    sql(`select status from bookings where id='${booking}'`) === "completed" &&
      sql(`select status from payouts where booking_id='${booking}'`) === "pending",
  );
  check(
    "every status change logged",
    sql(
      `select string_agg(coalesce(to_status::text,''), ',' order by created_at) from dispute_events where dispute_id='${dispute}' and event in ('opened','status_changed')`,
    ) === "open,escalated,resolved",
  );
  check(
    "admin actions audited",
    sql(
      `select count(*) from admin_actions where target_id='${dispute}' and action in ('dispute.escalate','dispute.business')`,
    ) === "2",
  );
  await customer.reload();
  check("customer sees the decision", await sees(customer, "Decided for the business"));
  check("no more messages once resolved", (await customer.getByLabel("Add to the dispute").count()) === 0);
  await shot(customer, "03-customer-resolved");

  // ---- 6. Withdraw
  await openDispute(customer, confirmed, {
    code: "late",
    summary: "Menu tasting not scheduled",
    description: "We still haven't had the tasting we agreed on two weeks ago.",
  });
  await customer.waitForURL(/\/dispute$/, { timeout: 20000 });
  const second = sql(`select id from disputes where booking_id='${confirmed}'`);
  check(
    "second dispute holds the booking",
    sql(`select status from bookings where id='${confirmed}'`) === "disputed",
  );
  await customer.getByRole("button", { name: "Withdraw the dispute" }).click();
  await customer.getByRole("button", { name: "Yes, withdraw" }).click();
  await customer.waitForTimeout(2000);
  check(
    "opener withdraws",
    sql(`select status||':'||outcome from disputes where id='${second}'`) === "closed:withdrawn",
  );
  check(
    "booking returns to confirmed",
    sql(`select status from bookings where id='${confirmed}'`) === "confirmed",
  );
  await customer.reload();
  check("customer sees it's withdrawn", await sees(customer, "Withdrawn"));
  await admin.goto(`${adminBase}/disputes?status=closed`);
  check("withdrawn shows under closed", await sees(admin, "Menu tasting not scheduled"));

  // ---- 7. Mobile
  const phone = await as("emeka@demo.ng", { width: 390, height: 844 });
  await phone.goto(`${base}/account/bookings/${booking}/dispute`);
  check(
    "no horizontal scroll on phone",
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  await shot(phone, "04-mobile-dispute");

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  results.push(`ERROR ${e.message.split("\n").join(" | ")}`);
} finally {
  await browser.close();
  console.log(results.join("\n"));
  console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
}
