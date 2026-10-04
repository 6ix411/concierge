// Stage 22: the JSON API for the future iOS and Android apps, and the installable web app (PWA).
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/stage-22`;
execSync(`mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q}"`,
  )
    .toString()
    .trim();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : extra}`);

/** Signs in the way a phone app does: Supabase Auth gives an access token. */
async function token(email) {
  const response = await fetch(`${supabase}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Password123" }),
  });
  return (await response.json()).access_token;
}
async function call(path, { as, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(as ? { authorization: `Bearer ${as}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json, headers: response.headers };
}
const tuesday = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const browser = await chromium.launch();
const errors = [];

try {
  // ---- 1. Public endpoints
  const categories = await call("/categories");
  check("visitors can list categories", categories.status === 200 && categories.json.data.length > 0);
  check("API answers are never cached", categories.headers.get("cache-control") === "no-store");

  const search = await call("/businesses?q=decor");
  const slugs = (search.json?.data?.results ?? []).map((b) => b.slug);
  check("search returns platform businesses", search.status === 200 && slugs.includes("lush-events-decor"));
  check("search never returns unapproved businesses", !slugs.includes("unverified-decor-hub"));

  const profile = await call("/businesses/lush-events-decor");
  check("a business profile loads", profile.status === 200 && profile.json.data.name === "Lush Events Décor");
  check(
    "an unapproved business is not found",
    (await call("/businesses/unverified-decor-hub")).status === 404,
  );
  check("a bad slug is not found", (await call("/businesses/..%2F..%2Fetc")).status === 404);

  // ---- 2. Signing in
  check("private endpoints need a token", (await call("/me")).status === 401);
  check(
    "a made-up token is refused",
    (await call("/me", { as: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad" })).status === 401,
  );
  const customer = await token("customer@demo.ng");
  const owner = await token("owner@demo.ng");
  const other = await token("tolu@demo.ng");
  const me = await call("/me", { as: customer });
  check("a token signs the app in", me.status === 200 && me.json.data.role === "customer");

  // The website's session cookie never works on the API (so other sites can't use a visitor's browser).
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/sign-in");
  await page.getByLabel("Email").fill("customer@demo.ng");
  await page.getByLabel("Password").fill("Password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  check(
    "the website's cookie doesn't sign in the API",
    (await page.request.get(base + "/api/v1/me")).status() === 401,
  );

  // ---- 3. Booking through the API, with the same rules as the website
  const serviceId = sql(
    "select s.id from business_services s join businesses b on b.id = s.business_id where b.slug = 'lush-events-decor' and s.name = 'Custom Event Styling'",
  );
  const request = {
    business: "lush-events-decor",
    mode: "quote",
    serviceIds: [serviceId],
    date: tuesday(23),
    time: "11:00",
    addressLine: "14 Glover Road",
    area: "Ikoyi",
    city: "Lagos",
    state: "Lagos",
    requestKey: crypto.randomUUID(),
  };
  check(
    "businesses can't book",
    (await call("/bookings", { as: owner, method: "POST", body: request })).status === 403,
  );
  const leaky = await call("/bookings", {
    as: customer,
    method: "POST",
    body: { ...request, notes: "Call me on 0803 123 4567", requestKey: crypto.randomUUID() },
  });
  check(
    "notes with a phone number are refused",
    leaky.status === 422 && Boolean(leaky.json.error.details.fields.notes),
    JSON.stringify(leaky.json),
  );
  const made = await call("/bookings", { as: customer, method: "POST", body: request });
  const id = made.json?.data?.id;
  check("a customer can ask for a quote", made.status === 200 && Boolean(id), JSON.stringify(made.json));
  const again = await call("/bookings", { as: customer, method: "POST", body: request });
  check("sending the same request again books nothing new", again.json?.data?.id === id);

  check("the customer reads their booking", (await call(`/bookings/${id}`, { as: customer })).status === 200);
  check(
    "another customer gets not found for it",
    (await call(`/bookings/${id}`, { as: other })).status === 404,
  );
  check("a bad id is not found", (await call("/bookings/1%20or%201=1", { as: customer })).status === 404);

  const seen = await call(`/bookings/${id}`, { as: owner });
  check("the business reads the request", seen.status === 200 && seen.json.data.area === "Ikoyi");
  check("but not the street address before payment", seen.json?.data?.address_line === null);
  check("nor the customer's email or phone", !/customer@demo\.ng|\+234/.test(JSON.stringify(seen.json)));

  const quoted = await call(`/bookings/${id}/quote`, {
    as: owner,
    method: "POST",
    body: { amount: 450000, notes: "Includes setup and teardown." },
  });
  check("the business sends a quote", quoted.status === 200, JSON.stringify(quoted.json));
  check(
    "the customer can't use business actions",
    (await call(`/bookings/${id}/accept`, { as: customer, method: "POST" })).status === 404,
  );
  check(
    "another customer can't cancel it",
    (await call(`/bookings/${id}/cancel`, { as: other, method: "POST", body: {} })).status >= 400,
  );
  check("status is quoted", sql(`select status from bookings where id='${id}'`) === "quoted");

  const accepted = await call(`/bookings/${id}/accept-quote`, { as: customer, method: "POST", body: {} });
  check("the customer accepts the quote", accepted.status === 200, JSON.stringify(accepted.json));
  const pay = await call(`/bookings/${id}/pay`, { as: customer, method: "POST", body: {} });
  check(
    "paying returns a checkout link",
    pay.status === 200 && typeof pay.json.data.checkoutUrl === "string",
    JSON.stringify(pay.json),
  );
  check(
    "payment isn't trusted from the app: still unpaid until the server verifies it",
    sql(`select status from bookings where id='${id}'`) === "payment_pending",
  );

  const list = await call("/bookings?tab=requests", { as: owner });
  check("the business lists its bookings", list.status === 200 && Array.isArray(list.json.data));
  const notes = await call("/notifications", { as: customer });
  check("notifications load", notes.status === 200 && typeof notes.json.data.unread === "number");

  // ---- 4. Installable web app
  const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
  check(
    "the web app manifest describes an installable app",
    manifest.display === "standalone" && manifest.icons.some((i) => i.sizes === "512x512"),
  );
  for (const icon of manifest.icons) {
    const response = await fetch(new URL(icon.src, base));
    check(
      `icon ${icon.src} loads`,
      response.status === 200 && response.headers.get("content-type") === "image/png",
    );
  }
  const sw = await fetch(base + "/sw.js");
  check(
    "the service worker is served uncached",
    sw.status === 200 && /no-cache/.test(sw.headers.get("cache-control")),
  );

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "/");
  const ready = await phone.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
    ]),
  );
  check("the service worker installs", ready);
  // The offline page is cached for when there's no connection. (Playwright's offline mode doesn't
  // reach service workers, so this reads the worker's cache directly.)
  const cached = await phone.evaluate(async () => {
    const response = await caches.match("/offline");
    return response ? await response.text() : "";
  });
  check("the offline page is ready in the cache", /You.re offline/.test(cached));
  check("and it is the signed-out version", !/Sign out|customer@demo/.test(cached) && /Sign in/.test(cached));
  await phone.goto(base + "/offline");
  await phone.screenshot({ path: `${shots}/offline.png` });

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  results.push(`ERROR ${e.message.split("\n").join(" | ")}`);
} finally {
  await browser.close();
  console.log(results.join("\n"));
  console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
}
