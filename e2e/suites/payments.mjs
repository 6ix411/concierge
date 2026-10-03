import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const adminBase = base + `/${process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e"}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-10`;
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
const webhook = (provider, body, headers = {}) =>
  fetch(`${base}/api/payments/webhook/${provider}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  }).then(async (r) => [r.status, await r.json()]);

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

  // ---- 1. Admin sets the platform commission (not hard-coded)
  await admin.goto(`${adminBase}/commission`);
  await admin.getByLabel("Commission (%)").fill("12.5");
  await admin.getByRole("button", { name: "Save" }).first().click();
  await sees(admin, "12.5%");
  check(
    "commission saved as data",
    sql(`select value from platform_settings where key='default_commission_rate_bps'`) === "1250",
  );

  // ---- 2. Customer books; the booking takes the admin's rate
  const book = async (days) => {
    await customer.goto(base + "/book/lush-events-decor");
    await customer.getByLabel(/Classic Wedding Decor/).check();
    await customer.getByLabel("Date").fill(tuesday(days));
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
    await owner.goto(`${base}/business/bookings/${id}`);
    await owner.getByRole("button", { name: "Accept booking" }).click();
    await sees(owner, "Accepted by the business");
    return id;
  };
  const id = await book(14);
  check(
    "booking uses the admin's commission",
    sql(`select commission_rate_bps from bookings where id='${id}'`) === "1250",
  );

  // ---- 3. Pays: verified server to server, split recorded
  await customer.goto(`${base}/checkout/${id}`);
  await shot(customer, "desktop-01-checkout");
  await customer.getByRole("button", { name: /Pay .* securely/ }).click();
  await customer.getByText("Payment received").first().waitFor({ timeout: 20000 });
  const pay = sql(
    `select p.amount_minor||'|'||p.currency||'|'||(p.business_id=b.business_id)||'|'||p.payer_id||'|'||p.commission_rate_bps||'|'||p.platform_fee_minor||'|'||p.provider_amount_minor||'|'||p.status||'|'||(p.paid_at is not null)||'|'||p.provider_reference||'|'||p.channel||'|'||(p.provider_payload->>'verifiedVia')||'|'||p.reference from payments p join bookings b on b.id=p.booking_id where p.booking_id='${id}'`,
  ).split("|");
  check("payment amount and currency", pay[0] === "120000000" && pay[1] === "NGN", pay.join("|"));
  check(
    "payment records business and customer",
    pay[2] === "true" && pay[3] === "a0000000-0000-0000-0000-000000000001",
    pay.join("|"),
  );
  check(
    "platform fee 12.5% and provider amount",
    pay[4] === "1250" && pay[5] === "15000000" && pay[6] === "105000000",
    pay.join("|"),
  );
  check(
    "status success with date, transaction ref, channel",
    pay[7] === "success" && pay[8] === "true" && pay[9].startsWith("MOCK-PAY-") && pay[10] === "card",
    pay.join("|"),
  );
  check("verified on the server (callback)", pay[11] === "callback", pay[11]);
  const main = await customer.locator("main").innerText();
  check("customer sees payment reference", main.includes(`Payment reference ${pay[12]}`), main.slice(0, 400));
  await shot(customer, "desktop-02-customer-paid");

  // ---- 4. Webhook: the browser never comes back, the provider's webhook confirms it
  const id2 = await book(21);
  await customer.route("**/api/payments/callback**", (route) => route.abort());
  await customer.goto(`${base}/checkout/${id2}`);
  await customer.getByRole("button", { name: /Pay .* securely/ }).click();
  await customer.waitForTimeout(3000);
  await customer.unroute("**/api/payments/callback**");
  const ref2 = sql(`select reference from payments where booking_id='${id2}'`);
  check(
    "without verification the payment stays pending",
    sql(`select status from payments where booking_id='${id2}'`) === "pending" &&
      sql(`select status from bookings where id='${id2}'`) === "payment_pending",
  );
  const [s1, b1] = await webhook("mock", { event: "charge.success", data: { reference: ref2 } });
  check("webhook accepted", s1 === 200 && b1.received === true, JSON.stringify(b1));
  check(
    "webhook confirms after verifying",
    sql(`select status||'|'||(provider_payload->>'verifiedVia') from payments where booking_id='${id2}'`) ===
      "success|webhook" && sql(`select status from bookings where id='${id2}'`) === "confirmed",
  );
  const [s2, b2] = await webhook("mock", { event: "charge.success", data: { reference: ref2 } });
  check("replayed webhook handled once", s2 === 200 && b2.note === "duplicate", JSON.stringify(b2));
  check(
    "webhook stored",
    sql(
      `select count(*)||'|'||bool_and(processed_at is not null) from payment_webhook_events where reference='${ref2}'`,
    ) === "1|true",
  );
  const [s3] = await webhook(
    "paystack",
    { event: "charge.success", data: { reference: ref2 } },
    { "x-paystack-signature": "forged" },
  );
  check("forged Paystack webhook refused", s3 === 401, String(s3));
  const [s4] = await webhook("mock", {
    event: "charge.success",
    data: { reference: "PAY-0000000000000000" },
  });
  check("unknown reference acknowledged, nothing changed", s4 === 200);

  // ---- 5. Job completed → payout of the provider amount
  await owner.goto(`${base}/business/bookings/${id}`);
  await owner.getByRole("button", { name: "Mark as started" }).click();
  await sees(owner, "Job started");
  await owner.getByRole("button", { name: "Mark as completed" }).click();
  await sees(owner, "Job completed");
  const po = sql(
    `select po.gross_minor||'|'||po.commission_minor||'|'||po.amount_minor||'|'||(po.payment_id=p.id)||'|'||po.status||'|'||po.id from payouts po join payments p on p.booking_id=po.booking_id where po.booking_id='${id}'`,
  ).split("|");
  check(
    "payout = payment's provider amount",
    po.slice(0, 5).join("|") === "120000000|15000000|105000000|true|pending",
    po.join("|"),
  );
  await admin.goto(`${adminBase}/payouts`);
  const bref = sql(`select reference from bookings where id='${id}'`);
  await sees(admin, bref);
  const row = admin.locator("li", { hasText: bref });
  check(
    "no bank account, no pay out button",
    (await row.innerText()).includes("No bank account yet") &&
      (await row.getByRole("button", { name: "Pay out" }).count()) === 0,
    await row.innerText(),
  );

  // ---- 6. Business adds a verified bank account
  await owner.goto(`${base}/business/earnings`);
  await sees(owner, "Where we pay you");
  await owner.getByLabel("Bank").selectOption({ label: "Guaranty Trust Bank" });
  await owner.getByLabel("Account number").fill("12345");
  await owner.getByRole("button", { name: "Verify and save" }).click();
  check("account number validated", await sees(owner, "10-digit account number"));
  await owner.getByLabel("Account number").fill("1234560000");
  await owner.getByRole("button", { name: "Verify and save" }).click();
  check("unknown account refused", await sees(owner, "couldn't find that account"));
  await owner.getByLabel("Account number").fill("0234567891");
  await owner.getByRole("button", { name: "Verify and save" }).click();
  check("account verified and saved", await sees(owner, "Payouts will go to DEMO BUSINESS ACCOUNT"));
  check(
    "saved with bank's name",
    sql(
      `select bank_name||'|'||account_name||'|'||account_number||'|'||(recipient_code is not null) from business_payout_accounts where business_id=(select id from businesses where slug='lush-events-decor')`,
    ) === "Guaranty Trust Bank|DEMO BUSINESS ACCOUNT|0234567891|true",
  );
  await shot(owner, "desktop-05-business-bank-account");

  // ---- 7. Admin pays out
  await admin.goto(`${adminBase}/payouts`);
  await sees(admin, bref);
  await shot(admin, "desktop-06-admin-payouts");
  await admin.locator("li", { hasText: bref }).getByRole("button", { name: "Pay out" }).click();
  check("payout sent", await sees(admin, "Payout sent. The money is in the business"));
  const sent = sql(
    `select status||'|'||reference||'|'||bank_name||'|'||account_number_last4||'|'||attempts||'|'||(paid_at is not null) from payouts where id='${po[5]}'`,
  ).split("|");
  check(
    "payout paid with our reference and bank snapshot",
    sent[0] === "paid" &&
      /^PO-[0-9A-F]{16}-1$/.test(sent[1]) &&
      sent[2] === "Guaranty Trust Bank" &&
      sent[3] === "7891" &&
      sent[4] === "1" &&
      sent[5] === "true",
    sent.join("|"),
  );
  check(
    "business notified of payout",
    sql(
      `select count(*) from notifications where user_id=(select owner_id from businesses where slug='lush-events-decor') and type='payout.paid'`,
    ) === "1",
  );
  await owner.goto(`${base}/business/earnings`);
  check(
    "business sees payout",
    await sees(owner, "Guaranty Trust Bank ••7891"),
    (await owner.locator("main").innerText()).slice(-600),
  );

  const readyBefore = Number(
    sql(
      `select count(*) from payouts po join business_payout_accounts a using (business_id) join bookings b on b.id=po.booking_id where po.status='pending' and b.status in ('completed','reviewed')`,
    ),
  );
  await admin.goto(`${adminBase}/payouts`);
  await admin.getByRole("button", { name: "Pay all ready" }).click();
  check("pay all ready", await sees(admin, /payouts? sent/));
  check(
    "every ready payout sent",
    readyBefore > 0 &&
      sql(
        `select count(*) from payouts po join business_payout_accounts a using (business_id) join bookings b on b.id=po.booking_id where po.status='pending' and b.status in ('completed','reviewed')`,
      ) === "0",
    String(readyBefore),
  );
  check("disputed payout stays on hold", sql(`select count(*) from payouts where status='on_hold'`) === "1");
  check(
    "payout audited",
    sql(`select count(*) from admin_actions where action in ('payout.send','payout.send_all')`) === "2",
  );

  // ---- 8. Admin payments page
  await admin.goto(`${adminBase}/payments`);
  await sees(admin, pay[12]);
  const pp = await admin.locator("main").innerText();
  check(
    "payments page shows all fields",
    [
      "Platform fee",
      "Business gets",
      pay[12],
      bref,
      "Chioma Okafor",
      "Lush Events",
      "₦150,000",
      "₦1,050,000",
      "NGN",
      "Successful",
    ].every((t) => pp.includes(t)),
    pp.slice(0, 800),
  );
  await shot(admin, "desktop-07-admin-payments");

  // ---- 9. Refund through the provider
  await customer.goto(`${base}/account/bookings/${id2}`);
  await customer.getByRole("button", { name: "Cancel booking" }).click();
  await customer.getByRole("button", { name: "Yes, cancel" }).click();
  await sees(customer, "Booking cancelled.");
  await admin.goto(`${adminBase}/bookings/${id2}`);
  await admin.getByRole("button", { name: /Refund .* to the customer/ }).click();
  await admin
    .getByRole("button", { name: /Refund .* to the customer/ })
    .last()
    .click();
  check("refund sent", await sees(admin, "refunded to the customer"));
  check(
    "payment refunded via provider",
    sql(
      `select status||'|'||refund_status||'|'||refund_reference||'|'||(refunded_at is not null) from payments where booking_id='${id2}'`,
    ).startsWith("refunded|processed|RFD_"),
    sql(`select status||'|'||refund_status from payments where booking_id='${id2}'`),
  );
  check("booking refunded", sql(`select status from bookings where id='${id2}'`) === "refunded");
  check(
    "payout withheld for refunded booking",
    sql(`select count(*) from payouts where booking_id='${id2}' and status<>'failed'`) === "0",
  );
  await customer.goto(`${base}/account/bookings/${id2}`);
  check("customer sees refund", await sees(customer, "Paid, then refunded"));

  // ---- 10. Mobile
  const mob = await as("owner@demo.ng", { width: 390, height: 844 });
  await mob.goto(`${base}/business/earnings`);
  await sees(mob, "Where we pay you");
  await shot(mob, "mobile-01-business-earnings");
  check(
    "no horizontal scroll on earnings (mobile)",
    !(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
  );
  const madmin = await as("admin@demo.ng", { width: 390, height: 844 });
  await madmin.goto(`${adminBase}/payouts?status=paid`);
  await sees(madmin, "Payouts");
  await shot(madmin, "mobile-02-admin-payouts");
  check(
    "no horizontal scroll on payouts (mobile)",
    !(await madmin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
  );
} catch (error) {
  check("script ran", false, String(error).slice(0, 500));
}
check(
  "no page errors",
  errors.filter((e) => !e.includes("net::ERR_FAILED")).length === 0,
  errors.join(" | "),
);
await browser.close();
console.log(results.join("\n"));
console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
