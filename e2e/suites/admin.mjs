import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const admin = `/${process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e"}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/admin`;
execSync(`mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);
const pageErrors = [];

const browser = await chromium.launch();
const newPage = async (width = 390, height = 844) => {
  const ctx = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(e.message));
  return p;
};
const shot = (p, name) => p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const ok = (p, text) => p.getByText(text).first().waitFor({ timeout: 15000 });
const signIn = async (p, email, password = "Password123") => {
  await p.goto(`${base}/sign-in`);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForLoadState("networkidle");
};
const audit = (action) => Number(sql(`select count(*) from admin_actions where action='${action}'`));

const adm = await newPage(1280, 900);
const phone = await newPage();
const customer = await newPage();
const tolu = await newPage();

try {
  // 1. Private link and overview
  await customer.goto(`${base}${admin}`);
  check(
    "visitors get 404 at the private link",
    (await customer.locator("body").innerText()).includes("Page not found"),
  );
  await signIn(adm, "admin@demo.ng");
  check("admin lands on the private dashboard", adm.url().includes(admin), adm.url());
  await ok(adm, "Needs attention");
  const overview = await adm.locator("main").innerText();
  check("overview shows customers", /Customers\s*3/.test(overview));
  const approvedNow = sql(`select count(*) from businesses where status='approved'`);
  check(
    "overview shows approved businesses",
    new RegExp(`Approved businesses\\s*${approvedNow}`).test(overview),
    approvedNow,
  );
  check("overview shows open disputes", /Open disputes\s*1/.test(overview));
  check("overview shows revenue", overview.includes("Revenue") && overview.includes("₦"));
  check(
    "overview ranks categories, services and businesses",
    ["Popular categories", "Popular services", "Most-booked businesses", "Lush Events Décor"].every((t) =>
      overview.includes(t),
    ),
  );
  check(
    "admin link never appears on the public site",
    !(await (await fetch(`${base}/`)).text()).includes(admin),
  );
  await shot(adm, "01-overview-desktop");
  await signIn(phone, "admin@demo.ng");
  await ok(phone, "Needs attention");
  await shot(phone, "02-overview-phone");
  check(
    "overview fits a phone screen",
    !(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
  );
  check(
    "categories roll up sub-categories",
    /Events · \d+ businesses\s*\d+ bookings/.test(overview),
    overview.slice(overview.indexOf("Popular categories"), overview.indexOf("Popular categories") + 120),
  );

  // 2. Providers: reject the pending one, suspend and reactivate an approved one
  await adm.goto(`${base}${admin}/businesses`);
  await adm.getByRole("link", { name: /Unverified Decor Hub/ }).click();
  await adm.getByRole("button", { name: "Reject" }).click();
  await adm.getByLabel(/Reason/).fill("We couldn't verify your CAC number.");
  await adm.getByRole("button", { name: "Reject" }).last().click();
  await ok(adm, "Last reason: We couldn't verify");
  check(
    "reject provider",
    sql(`select status from businesses where name='Unverified Decor Hub'`) === "rejected",
  );

  await adm.goto(`${base}${admin}/businesses?status=approved`);
  await adm.getByRole("link", { name: /Sparkle Home Cleaning/ }).click();
  await adm.getByRole("button", { name: "Suspend" }).click();
  await adm.getByLabel(/Reason/).fill("Several complaints this week.");
  await adm.getByRole("button", { name: "Suspend" }).last().click();
  await adm.getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15000 });
  check(
    "suspend provider",
    sql(`select status from businesses where slug='sparkle-home-cleaning'`) === "suspended",
  );
  const hidden = await (await fetch(`${base}/businesses/sparkle-home-cleaning`)).text();
  check("suspended provider leaves the marketplace", hidden.includes("noindex"));
  await adm.getByRole("button", { name: "Reactivate" }).click();
  await adm.getByRole("button", { name: "Suspend" }).waitFor({ timeout: 15000 });
  check(
    "reactivate provider",
    sql(`select status from businesses where slug='sparkle-home-cleaning'`) === "approved",
  );

  // 3. Custom commission on a provider
  await adm.getByLabel("Custom commission (%)").fill("8");
  await adm.getByRole("button", { name: "Save" }).click();
  await ok(adm, "now pays 8% on new bookings");
  check(
    "custom commission",
    sql(`select commission_rate_bps from businesses where slug='sparkle-home-cleaning'`) === "800",
  );
  await shot(adm, "03-provider");

  // 4. Platform commission
  await adm.goto(`${base}${admin}/commission`);
  await adm.getByLabel("Commission (%)").fill("12.5");
  await adm.getByRole("button", { name: "Save" }).click();
  await ok(adm, "Commission set to 12.5% for new bookings.");
  check(
    "platform commission saved",
    sql(`select value from platform_settings where key='default_commission_rate_bps'`) === "1250",
  );
  await adm.reload();
  await ok(adm, "Sparkle Home Cleaning");
  await shot(adm, "04-commission");

  // 5. Categories
  await adm.goto(`${base}${admin}/categories`);
  const addForm = adm.locator("form", { hasText: "Add category" });
  await addForm.getByLabel("Name").fill("Event Planning");
  await addForm.getByRole("button", { name: "Add category" }).click();
  await ok(adm, "Event Planning added.");
  check(
    "category created",
    sql(`select count(*) from service_categories where slug='event-planning'`) === "1",
  );
  const row = adm.locator("li", { hasText: "/event-planning" }).last();
  await row.getByRole("button", { name: "Edit" }).click();
  await row.getByLabel("Show on the marketplace").uncheck();
  await row.getByRole("button", { name: "Save category" }).click();
  await ok(adm, "Event Planning saved.");
  check(
    "category hidden",
    sql(`select is_active from service_categories where slug='event-planning'`) === "f",
  );
  await adm.getByRole("button", { name: "Delete Event Planning" }).click();
  await adm.getByText("/event-planning").waitFor({ state: "detached", timeout: 15000 });
  check(
    "unused category deleted",
    sql(`select count(*) from service_categories where slug='event-planning'`) === "0",
  );
  const usedName = sql(
    `select c.name from service_categories c join businesses b on b.primary_category_id=c.id limit 1`,
  );
  await adm
    .getByRole("button", { name: `Delete ${usedName}` })
    .first()
    .click();
  await ok(adm, "is in use");
  check(
    "category in use is protected",
    sql(`select count(*) from service_categories where name='${usedName.replace(/'/g, "''")}'`) !== "0",
  );
  await shot(adm, "05-categories");

  // 6. Bookings: cancel a request
  await adm.goto(`${base}${admin}/bookings`);
  await adm.getByRole("link", { name: /Royal Touch Decorations/ }).click();
  await adm.getByRole("button", { name: "Cancel booking" }).click();
  await adm.getByLabel(/Reason/).fill("Duplicate request.");
  await adm.getByRole("button", { name: "Cancel booking" }).last().click();
  await ok(adm, "Cancelled by the Concierge team");
  check(
    "admin cancels a booking",
    sql(
      `select b.status from bookings b join businesses x on x.id=b.business_id where x.slug='royal-touch-decorations' and b.status <> 'completed'`,
    ) === "cancelled",
  );
  await shot(adm, "06-booking");

  // 7. Seeded dispute: review and side with the business
  await adm.goto(`${base}${admin}/disputes`);
  await adm.getByRole("link", { name: /Problem came back/ }).click();
  await adm.getByRole("button", { name: "Start review" }).click();
  await adm.getByRole("button", { name: "Start review" }).waitFor({ state: "detached", timeout: 15000 });
  check("dispute under review", sql(`select status from disputes`) === "under_review");
  await shot(adm, "07-dispute");
  await adm.getByRole("button", { name: "Side with the business" }).click();
  await adm.getByLabel("Explain the decision").fill("The plumber returned and fixed it; photos confirm.");
  await adm.getByRole("button", { name: "Side with the business" }).last().click();
  await ok(adm, "The plumber returned and fixed it; photos confirm.");
  const fixit = sql(
    `select b.status || '|' || p.status from bookings b join payouts p on p.booking_id=b.id join disputes d on d.booking_id=b.id`,
  );
  check("dispute for business completes booking and releases payout", fixit === "completed|pending", fixit);

  // 8. Customer reports a problem; admin refunds
  const emeka = await newPage();
  await signIn(emeka, "emeka@demo.ng");
  const mamaPut = sql(
    `select b.id from bookings b join businesses x on x.id=b.business_id where x.slug='mama-put-catering' and b.status='confirmed'`,
  );
  await emeka.goto(`${base}/account/bookings/${mamaPut}`);
  await emeka.getByRole("button", { name: "Report a problem" }).click();
  await emeka.getByLabel("What went wrong?").fill("Caterer cancelled on WhatsApp");
  await emeka.getByLabel(/Details/).fill("They messaged to say they can't make our date.");
  await emeka.getByRole("button", { name: "Send to Concierge" }).click();
  await ok(emeka, "Problem reported");
  check("customer opens a dispute", sql(`select status from bookings where id='${mamaPut}'`) === "disputed");
  check(
    "admins are notified of new disputes",
    sql(
      `select count(*) from notifications n join users u on u.id=n.user_id where u.role='admin' and n.type='dispute.opened'`,
    ) === "1",
  );
  await shot(emeka, "08-customer-dispute");

  await adm.goto(`${base}${admin}/disputes`);
  await adm.getByRole("link", { name: /Caterer cancelled/ }).click();
  await adm.getByRole("button", { name: "Refund the customer" }).click();
  await adm.getByLabel("Explain the decision").fill("The caterer confirmed they can't attend.");
  await adm.getByRole("button", { name: "Refund the customer" }).last().click();
  await ok(adm, "Refund due");
  check(
    "refund outcome cancels booking and records refund",
    sql(
      `select b.status || '|' || (d.refund_due_minor = b.total_minor) from bookings b join disputes d on d.booking_id=b.id where b.id='${mamaPut}'`,
    ) === "cancelled|true",
  );
  await emeka.reload();
  await ok(emeka, "will be refunded to you");
  check("customer sees the refund", true);

  // 9. Reviews
  await adm.goto(`${base}${admin}/reviews`);
  const reviewItem = adm.locator("li", { hasText: "Fixed the leak quickly" });
  await reviewItem.getByRole("button", { name: "Hide review" }).click();
  await reviewItem.getByLabel(/Why is it hidden/).fill("Contains a phone number.");
  await reviewItem.getByRole("button", { name: "Hide review" }).click();
  await reviewItem.getByRole("button", { name: "Publish again" }).waitFor({ timeout: 15000 });
  check("hide review", sql(`select status from reviews where comment like 'Fixed the leak%'`) === "hidden");
  check(
    "hidden review leaves the rating",
    sql(`select rating_count from businesses where slug='fixit-plumbing'`) === "0",
  );
  await adm.goto(`${base}${admin}/reviews?status=hidden`);
  await adm.getByRole("button", { name: "Publish again" }).click();
  await adm.getByRole("button", { name: "Publish again" }).waitFor({ state: "detached", timeout: 15000 });
  check(
    "publish review",
    sql(`select status from reviews where comment like 'Fixed the leak%'`) === "published",
  );

  // 10. Users
  await adm.goto(`${base}${admin}/users`);
  await adm.getByLabel("Search users").fill("tolu");
  await adm.getByRole("button", { name: "Search" }).click();
  await adm.waitForURL(/q=tolu/);
  await adm.getByRole("link", { name: /Tolu Adebayo/ }).click();
  await adm.getByRole("button", { name: "Suspend account" }).click();
  await adm.getByLabel(/Reason/).fill("Chargeback abuse.");
  await adm.getByRole("button", { name: "Suspend account" }).last().click();
  await adm.getByRole("button", { name: "Reactivate account" }).waitFor({ timeout: 15000 });
  check("suspend user", sql(`select status from users where email='tolu@demo.ng'`) === "suspended");
  await signIn(tolu, "tolu@demo.ng");
  await tolu.goto(`${base}/account`);
  await tolu.waitForLoadState("networkidle");
  check("suspended user is locked out", tolu.url().includes("account-suspended"), tolu.url());
  await adm.getByRole("button", { name: "Reactivate account" }).click();
  await adm.getByRole("button", { name: "Reactivate account" }).last().click();
  await adm.getByRole("button", { name: "Suspend account" }).waitFor({ timeout: 15000 });
  check("reactivate user", sql(`select status from users where email='tolu@demo.ng'`) === "active");
  await shot(adm, "09-user");

  await adm.goto(`${base}${admin}/users?role=business&q=fixit`);
  await adm.getByRole("link", { name: /Musa Ibrahim/ }).click();
  await adm.getByRole("button", { name: "Suspend account" }).click();
  await adm.getByLabel(/Reason/).fill("Fraud investigation.");
  await adm.getByRole("button", { name: "Suspend account" }).last().click();
  await adm.getByRole("button", { name: "Reactivate account" }).waitFor({ timeout: 15000 });
  check(
    "suspending an owner takes their business down",
    sql(`select status from businesses where slug='fixit-plumbing'`) === "suspended",
  );
  await adm.goto(`${base}${admin}/users/a0000000-0000-0000-0000-0000000000ad`);
  await ok(adm, "This is your account");
  check(
    "admins can't suspend themselves",
    (await adm.getByRole("button", { name: "Suspend account" }).count()) === 0,
  );

  // 11. Audit log
  await adm.goto(`${base}${admin}/audit`);
  await ok(adm, "Every important admin action");
  const log = await adm.locator("main").innerText();
  check(
    "audit log lists decisions",
    [
      "Rejected a business",
      "Suspended a business",
      "Reactivated a business",
      "Changed the platform commission",
      "Created a category",
      "Deleted a category",
      "Cancelled a booking",
      "Resolved a dispute for the business",
      "Resolved a dispute for the customer",
      "Hid a review",
      "Suspended a user",
      "Reactivated a user",
    ].every((t) => log.includes(t)),
    log.slice(0, 400),
  );
  check("audit entries carry reasons", log.includes("Chargeback abuse."));
  check(
    "every admin action was logged once",
    audit("user.suspend") === 2 && audit("settings.commission") === 1 && audit("category.create") === 1,
  );
  await shot(adm, "10-audit");
  await adm.getByRole("link", { name: "Disputes" }).last().click();
  await adm.waitForURL(/type=disputes/);
  check("audit log filters by type", !(await adm.locator("main").innerText()).includes("Suspended a user"));

  // Phone screenshots of the lists
  for (const [path, name] of [
    ["/bookings", "11-bookings-phone"],
    ["/disputes?status=closed", "12-disputes-phone"],
    ["/users", "13-users-phone"],
  ]) {
    await phone.goto(`${base}${admin}${path}`);
    await phone.waitForLoadState("networkidle");
    await shot(phone, name);
  }
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no horizontal scroll on phones", !overflow);
} catch (error) {
  results.push("ERROR " + error.message.split("\n").slice(0, 3).join(" | "));
  await shot(adm, "zz-admin");
  await shot(customer, "zz-customer");
}
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(results.join("\n"));
await browser.close();
