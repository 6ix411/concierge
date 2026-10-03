import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const adminBase = base + `/${process.env.ADMIN_PATH ?? "5c1e0f7a9b2d4e6f8a0c2e4f6a8b0d1e"}`;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-11`;
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
  await p.goto(base + "/sign-in");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill("Password123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  return p;
}
const send = async (p, text) => {
  await p.getByLabel("Message", { exact: true }).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
  await p.getByText(text).first().waitFor({ timeout: 10000 });
};

try {
  const convo = sql(
    `select c.id from conversations c join bookings b on b.id=c.booking_id join businesses z on z.id=c.business_id where z.slug='mama-put-catering' and b.status='confirmed'`,
  );
  const ref = sql(
    `select b.reference from conversations c join bookings b on b.id=c.booking_id where c.id='${convo}'`,
  );
  const customer = await as("emeka@demo.ng");
  const business = await as("mamaput@demo.ng");
  const admin = await as("admin@demo.ng");

  // ---- 1. The chat belongs to the booking
  await customer.goto(`${base}/account/messages/${convo}`);
  const info = await customer.getByRole("region", { name: "Booking details" }).innerText();
  check(
    "booking info in chat",
    [`#${ref}`, "Emeka Nwosu", "Mama Put Catering", "Wedding Catering", "Date"].every((t) =>
      info.includes(t),
    ),
    info,
  );
  check("tells people no AI is in the chat", await sees(customer, "No AI reads or writes here"));
  check(
    "no phone number shown",
    !(await customer.locator("main").innerText()).match(/0[789][01]\d{8}|\+234/),
  );
  await business.goto(`${base}/business/messages/${convo}`);
  await sees(business, "Booking details").catch(() => {});

  // ---- 2. Real-time text both ways, timestamps
  await send(customer, "Hello! Can we confirm the menu for 200 guests?");
  check("business receives in real time", await sees(business, "Can we confirm the menu", 10000));
  check("messages have timestamps", (await customer.locator("li time").count()) > 0);
  await send(business, "Yes. Jollof, fried rice and small chops. I'll send the menu.");
  check("customer receives in real time", await sees(customer, "Jollof, fried rice", 10000));

  // ---- 3. Read receipts
  await customer.getByTestId("receipt").last().waitFor();
  await send(customer, "Great, thank you");
  check(
    "sent receipt",
    (await customer.getByTestId("receipt").last().innerText()).includes("Sent") ||
      (await customer.getByTestId("receipt").last().innerText()).includes("Seen"),
  );
  check(
    "seen once the business has it open",
    await customer
      .getByTestId("receipt")
      .last()
      .getByText("Seen")
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      ),
  );

  // ---- 4. Photos, videos and files
  for (const [file, label] of [
    ["decor-sample.png", "photo"],
    ["venue-walkthrough.mp4", "video"],
    ["menu.pdf", "file"],
  ]) {
    await business.locator("#chat-file").setInputFiles(`${files}/${file}`);
    await business.getByRole("button", { name: "Send" }).click();
    await business.waitForTimeout(1500);
    check(
      `${label} stored`,
      sql(`select count(*) from messages where conversation_id='${convo}' and attachment_name='${file}'`) ===
        "1",
    );
  }
  await customer.waitForTimeout(1500);
  check("customer sees the photo", (await customer.locator('img[alt="decor-sample.png"]').count()) === 1);
  check("customer sees the video player", (await customer.locator("video").count()) === 1);
  check("customer sees the file with its name", await sees(customer, "menu.pdf"));
  await business
    .locator("#chat-file")
    .setInputFiles({ name: "script.sh", mimeType: "application/x-sh", buffer: Buffer.from("echo hi") });
  check("unsafe file types refused", await sees(business, "That type of file can't be sent"));

  // ---- 5. Notifications
  check(
    "one notification for several messages",
    sql(
      `select count(*) from notifications where user_id='b0000000-0000-0000-0000-000000000003' and type='message.new'`,
    ) === "1",
  );
  check(
    "notification cleared when the chat is read",
    sql(
      `select count(*) from notifications where user_id='b0000000-0000-0000-0000-000000000003' and type='message.new' and read_at is null`,
    ) === "0",
  );
  check(
    "customer notified of business reply",
    sql(
      `select count(*) from notifications where user_id=(select customer_id from conversations where id='${convo}') and type='message.new'`,
    ) === "1",
  );

  // ---- 6. Keep it on the platform
  await customer.getByLabel("Message", { exact: true }).fill("Can I call you on 08031234567?");
  check("contact sharing reminder", await sees(customer, "Looks like you're sharing contact details"));
  await customer.getByLabel("Message", { exact: true }).fill("");
  await shot(customer, "desktop-01-customer-chat");
  await shot(business, "desktop-02-business-chat");

  // ---- 7. Report a message and a person
  await business.goto(`${base}/business/messages/${convo}`);
  await business.getByRole("button", { name: "Report this message" }).last().click();
  await business.getByLabel("Reason").selectOption("off_platform_payment");
  await business.getByLabel(/What happened/).fill("Asked to pay by bank transfer directly.");
  await business.getByRole("button", { name: "Send report" }).click();
  check("message reported", await sees(business, "The Concierge team will review it"));
  check(
    "report stored and message flagged",
    sql(
      `select count(*) from chat_reports r join messages m on m.id=r.message_id where r.conversation_id='${convo}' and m.is_flagged`,
    ) === "1",
  );
  check(
    "admin notified of report",
    sql(
      `select count(*) from notifications n join users u on u.id=n.user_id where u.role='admin' and n.type='chat.report'`,
    ) !== "0",
  );
  await business.goto(`${base}/business/messages/${convo}`);
  await business.getByRole("button", { name: /Report Emeka/ }).click();
  await business.getByLabel("Reason").selectOption("harassment");
  await business.getByRole("button", { name: "Send report" }).click();
  check("person reported", await sees(business, "The Concierge team will review it"));

  // ---- 8. Block
  await business.goto(`${base}/business/messages/${convo}`);
  await business.getByRole("button", { name: "Block", exact: true }).click();
  await business.getByRole("button", { name: "Block", exact: true }).last().click();
  check("blocked", await sees(business, "You blocked this person"));
  await customer.goto(`${base}/account/messages/${convo}`);
  check(
    "blocked person can't send",
    (await sees(customer, "You can't send messages in this conversation")) &&
      (await customer.getByLabel("Message", { exact: true }).count()) === 0,
  );
  await business.getByRole("button", { name: "Unblock" }).click();
  check("unblocked", await sees(business, "Unblocked."));
  await customer.goto(`${base}/account/messages/${convo}`);
  check(
    "can talk again after unblock",
    (await customer.getByLabel("Message", { exact: true }).count()) === 1,
  );

  // ---- 9. Admin: reports, read-only chat, audit, moderation, restriction
  await admin.goto(`${adminBase}/reports`);
  check(
    "admin sees reports",
    (await sees(admin, "Asking to pay outside Concierge")) && (await sees(admin, "Harassment or abuse")),
  );
  await shot(admin, "desktop-03-admin-reports");
  await admin.getByText("Asking to pay outside Concierge").first().click();
  await sees(admin, "this visit is in the audit log");
  check("admin chat view shows messages", await sees(admin, "Can we confirm the menu"));
  check(
    "chat visit audited",
    sql(`select count(*) from admin_actions where action='conversation.view' and target_id='${convo}'`) ===
      "1",
  );
  await shot(admin, "desktop-04-admin-chat");
  const hideId = sql(
    `select id from messages where conversation_id='${convo}' and body like 'Great, thank you%'`,
  );
  await admin.locator(`#message-${hideId}`).getByRole("button", { name: "Hide message" }).click();
  await sees(admin, "Message hidden.");
  await customer.goto(`${base}/account/messages/${convo}`);
  await sees(customer, "Jollof");
  check("hidden message gone for participants", (await customer.getByText("Great, thank you").count()) === 0);
  await admin.goto(`${adminBase}/conversations/${convo}`);
  await admin.getByRole("button", { name: "Restrict chat" }).click();
  await admin.getByLabel(/Reason/).fill("Off-platform payment request under review.");
  await admin.getByRole("button", { name: "Restrict chat" }).last().click();
  check("chat restricted", await sees(admin, "Chat restricted."));
  await customer.goto(`${base}/account/messages/${convo}`);
  check(
    "customer sees restriction",
    await sees(customer, "The Concierge team has restricted this conversation"),
  );
  await admin.goto(`${adminBase}/conversations/${convo}`);
  await admin.getByRole("button", { name: "Lift restriction" }).click();
  check("restriction lifted", await sees(admin, "Chat reopened."));
  await admin.goto(`${adminBase}/conversations/${convo}`);
  await admin.getByRole("button", { name: "Dismiss" }).first().click();
  await admin.waitForTimeout(1500);
  check(
    "report resolved",
    sql(`select count(*) from chat_reports where conversation_id='${convo}' and status='dismissed'`) === "1",
  );

  const privateConvo = sql(
    `select c.id from conversations c where not exists (select 1 from chat_reports r where r.conversation_id=c.id) and not exists (select 1 from disputes d where d.booking_id=c.booking_id) limit 1`,
  );
  await admin.goto(`${adminBase}/conversations/${privateConvo}`);
  check("admin can't browse chats without a dispute or report", await sees(admin, "This chat is private"));
  const disputed = sql(
    `select c.id from conversations c join disputes d on d.booking_id=c.booking_id limit 1`,
  );
  const disputeId = sql(
    `select d.id from disputes d join conversations c on c.booking_id=d.booking_id limit 1`,
  );
  await admin.goto(`${adminBase}/disputes/${disputeId}`);
  await admin.getByRole("link", { name: "Read the chat" }).click();
  check("dispute gives admin access to the chat", await sees(admin, "Opened because of a dispute"));
  check("dispute chat id", admin.url().includes(disputed));

  // ---- 10. Lists and mobile
  await customer.goto(`${base}/account/messages/${convo}`);
  await send(customer, "Thanks for sorting this out.");
  await business.goto(`${base}/business/messages`);
  check("unread badge in business inbox", await sees(business, "New"));
  const mobile = await as("emeka@demo.ng", { width: 390, height: 844 });
  await mobile.goto(`${base}/account/messages/${convo}`);
  await sees(mobile, "Booking details").catch(() => {});
  await mobile.waitForTimeout(1000);
  await shot(mobile, "mobile-01-chat");
  check(
    "no horizontal scroll on mobile",
    !(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
  );
} catch (error) {
  check("script ran", false, String(error).slice(0, 500));
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(results.join("\n"));
console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
