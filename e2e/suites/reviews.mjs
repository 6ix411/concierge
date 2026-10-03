import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const adminBase = base + `/${process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e"}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-12`;
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
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  if (!email) return p;
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
// Photos load lazily: bring each into view, then wait for it to decode.
async function imagesLoaded(p, selector) {
  const imgs = p.locator(selector);
  await imgs
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  const n = await imgs.count();
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      ok = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
      if (!ok) await p.waitForTimeout(200);
    }
    if (!ok) return false;
  }
  return true;
}

try {
  const booking = sql(
    `select bk.id from bookings bk join businesses b on b.id=bk.business_id where b.slug='royal-touch-decorations' and bk.customer_id='a0000000-0000-0000-0000-000000000003' and bk.status='completed'`,
  );
  const confirmed = sql(
    `select id from bookings where customer_id='a0000000-0000-0000-0000-000000000003' and status='confirmed' limit 1`,
  );
  const countBefore = Number(sql(`select rating_count from businesses where slug='royal-touch-decorations'`));
  const customer = await as("emeka@demo.ng");
  const business = await as("royal@demo.ng");
  const admin = await as("admin@demo.ng");
  const other = await as("customer@demo.ng");
  const visitor = await as(null);

  // ---- 1. Only completed bookings, only your own
  await other.goto(`${base}/account/bookings/${booking}/review`);
  check(
    "someone else's booking can't be reviewed",
    (await other.title()).toLowerCase().includes("not found") || (await sees(other, "not found", 4000)),
  );
  await customer.goto(`${base}/account/bookings/${confirmed}/review`);
  await customer.waitForURL((u) => !u.pathname.endsWith("/review"), { timeout: 10000 }).catch(() => {});
  check(
    "a booking that isn't completed can't be reviewed",
    !customer.url().endsWith("/review"),
    customer.url(),
  );

  // ---- 2. Waiting for review
  await customer.goto(`${base}/account/reviews`);
  check("completed booking waits for a review", await sees(customer, "Waiting for your review"));
  await customer.getByRole("link", { name: "Review", exact: true }).first().click();
  await customer.waitForURL(/\/review$/);
  check("guidelines shown", await sees(customer, "Review guidelines"));

  // ---- 3. Photos: limits and checks
  await customer.getByRole("button", { name: /^4 stars/ }).click();
  await customer.locator("#review-photos").setInputFiles(Array(5).fill(`${files}/decor-sample.png`));
  check("a fifth photo is refused", await sees(customer, "Add up to 4 photos."));
  check("no previews after a refused pick", (await customer.locator('img[alt^="Photo "]').count()) === 0);
  await customer.locator("#review-photos").setInputFiles(`${files}/big.jpg`);
  check("large photo refused", await sees(customer, "Each photo must be 5 MB or smaller."));
  await customer.locator("#review-photos").setInputFiles(`${files}/fake.jpg`);
  await customer.getByRole("button", { name: "Post review" }).click();
  check(
    "a file pretending to be a photo is refused by the server",
    await sees(customer, "fake.jpg isn't a JPG, PNG or WebP photo."),
  );
  check(
    "nothing saved after a refused photo",
    sql(`select count(*) from reviews where booking_id='${booking}'`) === "0",
  );

  await customer.goto(`${base}/account/bookings/${booking}/review`);
  await customer.getByRole("button", { name: /^4 stars/ }).click();
  await customer
    .locator("#review-photos")
    .setInputFiles([`${files}/decor-sample.png`, `${files}/decor-sample.png`]);
  await customer.locator("#review-photos").setInputFiles(`${files}/decor-sample.png`);
  check("photos add up to three previews", (await customer.locator('img[alt^="Photo "]').count()) === 3);
  await customer.getByRole("button", { name: "Remove photo 3" }).click();
  check(
    "a photo can be removed before posting",
    (await customer.locator('img[alt^="Photo "]').count()) === 2,
  );
  await customer
    .getByLabel(/Tell others about your experience/)
    .fill("Beautiful reception decor, set up on time. The flowers were fresh.");
  await shot(customer, "01-review-form");
  await customer.getByRole("button", { name: "Post review" }).click();
  await customer.waitForURL(/reviewed=1/, { timeout: 20000 });
  check(
    "review saved",
    sql(`select rating||':'||status from reviews where booking_id='${booking}'`) === "4:published",
  );
  const review = sql(`select id from reviews where booking_id='${booking}'`);
  check("two photos saved", sql(`select count(*) from review_photos where review_id='${review}'`) === "2");
  check(
    "photo files stored privately",
    sql(
      `select count(*) from storage.objects where bucket_id='review-photos' and name like '${review}/%'`,
    ) === "2",
  );
  check("booking marked reviewed", sql(`select status from bookings where id='${booking}'`) === "reviewed");
  check(
    "rating counts the review",
    Number(sql(`select rating_count from businesses where slug='royal-touch-decorations'`)) ===
      countBefore + 1,
  );
  check(
    "business notified",
    sql(
      `select count(*) from notifications where user_id='b0000000-0000-0000-0000-000000000002' and type='review.created'`,
    ) === "1",
  );

  // ---- 4. No duplicates
  await customer.goto(`${base}/account/bookings/${booking}/review`);
  await customer.waitForURL((u) => !u.pathname.endsWith("/review"), { timeout: 10000 }).catch(() => {});
  check("can't review the same booking twice", !customer.url().endsWith("/review"), customer.url());
  await customer.goto(`${base}/account/reviews`);
  check(
    "customer sees own review with photos",
    await imagesLoaded(customer, 'main img[alt^="Review photo"]'),
  );

  // ---- 5. Public profile
  await visitor.goto(`${base}/businesses/royal-touch-decorations`);
  check("review on the public profile", await sees(visitor, "The flowers were fresh."));
  check("reviewer shown as first name and initial", await sees(visitor, "Emeka N."));
  check("photos load on the public profile", await imagesLoaded(visitor, 'img[alt^="Photo from Emeka N."]'));
  const src = await visitor.locator('img[alt^="Photo from Emeka N."]').first().getAttribute("src");
  check(
    "photo links are signed, not public",
    src.includes("/object/sign/review-photos/") && src.includes("token="),
    src,
  );
  await visitor.locator("#reviews-heading").scrollIntoViewIfNeeded();
  await shot(visitor, "02-public-profile-review");

  // ---- 6. Business replies and reports
  await business.goto(`${base}/business/reviews`);
  check("business sees the photos", await imagesLoaded(business, 'main img[alt^="Review photo"]'));
  const item = business.locator("li", { hasText: "The flowers were fresh." });
  await item.getByRole("button", { name: "Reply" }).click();
  await item.getByLabel("Your public reply").fill("Thank you Emeka, it was a pleasure.");
  await item.getByRole("button", { name: "Post reply" }).click();
  check("business replies", await sees(business, "Reply posted."));
  await visitor.reload();
  check("reply shows publicly", await sees(visitor, "Thank you Emeka, it was a pleasure."));
  check(
    "customer notified of the reply",
    sql(
      `select count(*) from notifications where user_id='a0000000-0000-0000-0000-000000000003' and type='review.replied'`,
    ) === "1",
  );

  await item.getByRole("button", { name: "Report to Concierge" }).click();
  await item.getByLabel("Which guideline does this review break?").fill("short");
  await item.getByRole("button", { name: "Send report" }).click();
  check("a report needs a real reason", await sees(business, "Tell us which guideline it breaks"));
  await item
    .getByLabel("Which guideline does this review break?")
    .fill("The second photo is from another company's event, not our work.");
  await item.getByRole("button", { name: "Send report" }).click();
  check(
    "business reports the review",
    await sees(
      business,
      /Sent. The Concierge team will check it|Reported. The Concierge team is checking it/,
    ),
  );
  check(
    "review stays up while reported",
    sql(`select status||':'||(reported_at is not null) from reviews where id='${review}'`) ===
      "published:true",
  );
  check(
    "admins notified of the report",
    Number(sql(`select count(*) from notifications where type='review.reported'`)) >= 1,
  );
  await business.reload();
  check(
    "business sees it's being checked",
    await sees(business, "Reported. The Concierge team is checking it."),
  );
  await shot(business, "03-business-reviews");

  // ---- 7. Admin moderation
  await admin.goto(`${adminBase}/reviews?status=reported`);
  check("admin sees reported reviews", await sees(admin, "The business says:"));
  check("admin sees the photos", await imagesLoaded(admin, 'main img[alt^="Review photo"]'));
  await shot(admin, "04-admin-reported");
  const second = admin.locator("main li li", { has: admin.locator('img[alt="Review photo 2"]') });
  await second.getByRole("button", { name: "Remove photo" }).click();
  await second.getByLabel("Why? (the reviewer will see this)").fill("This photo isn't from your booking.");
  await second.getByRole("button", { name: "Remove photo" }).click();
  await admin.waitForTimeout(1500);
  check(
    "admin removes one photo",
    sql(`select count(*) from review_photos where review_id='${review}'`) === "1",
  );
  check(
    "removed photo file deleted",
    sql(
      `select count(*) from storage.objects where bucket_id='review-photos' and name like '${review}/%'`,
    ) === "1",
  );
  check(
    "reviewer told why",
    sql(
      `select count(*) from notifications where user_id='a0000000-0000-0000-0000-000000000003' and type='review.photo_removed'`,
    ) === "1",
  );
  await admin.goto(`${adminBase}/reviews?status=reported`);
  await admin.getByRole("button", { name: "Keep review" }).click();
  await admin
    .getByLabel(/Note for the business/)
    .fill("We removed the photo that wasn't from this job. The review stays.");
  await admin.getByRole("button", { name: "Keep review" }).click();
  await admin.waitForTimeout(1500);
  check(
    "report closed, review stays",
    sql(`select status||':'||(reported_at is null) from reviews where id='${review}'`) === "published:true",
  );
  check(
    "business told the outcome",
    sql(
      `select count(*) from notifications where user_id='b0000000-0000-0000-0000-000000000002' and type='review.report_resolved'`,
    ) === "1",
  );
  check(
    "actions audited",
    sql(
      `select count(*) from admin_actions where action in ('review.photo_removed','review.report_dismissed')`,
    ) === "2",
  );

  await admin.goto(`${adminBase}/reviews`);
  const row = admin.locator("li", { hasText: "The flowers were fresh." });
  await row.getByRole("button", { name: "Hide review" }).click();
  await row.getByLabel(/Why is it hidden/).fill("Testing moderation.");
  await row.getByRole("button", { name: "Hide review" }).click();
  await admin.waitForTimeout(1500);
  check("admin hides the review", sql(`select status from reviews where id='${review}'`) === "hidden");
  check(
    "hidden review leaves the rating",
    Number(sql(`select rating_count from businesses where slug='royal-touch-decorations'`)) === countBefore,
  );
  await visitor.reload();
  check("hidden review gone from the profile", !(await visitor.getByText("The flowers were fresh.").count()));
  await customer.goto(`${base}/account/reviews`);
  check("customer told it's hidden", await sees(customer, "Hidden by the Concierge team"));

  // ---- 8. Mobile
  sql(`update reviews set status='published' where id='${review}'`);
  const phone = await as(null, { width: 390, height: 844 });
  await phone.goto(`${base}/businesses/royal-touch-decorations`);
  await phone.locator("#reviews-heading").scrollIntoViewIfNeeded();
  check(
    "no horizontal scroll on phone",
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  await shot(phone, "05-mobile-profile");

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  results.push(`ERROR ${e.message.split("\n").join(" | ")}`);
} finally {
  await browser.close();
  console.log(results.join("\n"));
  const passed = results.filter((r) => r.startsWith("PASS")).length;
  console.log(`${passed}/${results.length} passed`);
}
