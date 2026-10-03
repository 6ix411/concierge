// Phone audit: visits every customer and business page at 360px and reports layout problems.
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shots = `${process.env.E2E_SHOTS ?? "e2e/screenshots"}/audit`;
execSync(`rm -rf ${shots} && mkdir -p ${shots}`);
const sql = (q) =>
  execSync(
    `psql ${process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"} -Atc "${q}"`,
  )
    .toString()
    .trim();
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const browser = await chromium.launch();
const viewport = { width: Number(process.env.W ?? 360), height: 740 };

async function as(email) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    userAgent: UA,
    isMobile: true,
    hasTouch: true,
  });
  const p = await ctx.newPage();
  if (email) {
    await p.goto(base + "/sign-in");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Password").fill("Password123");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
  }
  return p;
}

const booking = (status, email = "customer@demo.ng") =>
  sql(
    `select b.id from bookings b join users u on u.id=b.customer_id where u.email='${email}' and b.status='${status}' limit 1`,
  );
const convo = sql(
  `select c.id from conversations c join users u on u.id=c.customer_id where u.email='emeka@demo.ng' limit 1`,
);
const bizBooking = sql(
  `select b.id from bookings b join businesses z on z.id=b.business_id join users u on u.id=z.owner_id where u.email='owner@demo.ng' limit 1`,
);
const bizConvo = sql(
  `select c.id from conversations c join businesses z on z.id=c.business_id join users u on u.id=z.owner_id where u.email='owner@demo.ng' limit 1`,
);
const ids = "frames-by-kemi,lens-and-light,snapshot-studios";

const routes = {
  visitor: [
    "/",
    "/services",
    "/services/events",
    "/search?q=photographer&location=Lekki",
    "/concierge",
    "/businesses/frames-by-kemi",
    `/compare?ids=${ids}`,
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/become-a-provider",
  ],
  "customer@demo.ng": [
    "/account",
    "/account/bookings",
    `/account/bookings/${booking("pending_provider")}`,
    `/account/bookings/${booking("reviewed")}`,
    "/account/messages",
    "/account/reviews",
    "/account/settings",
    "/notifications",
    "/book/frames-by-kemi",
  ],
  "emeka@demo.ng": [
    `/account/messages/${convo}`,
    "/concierge",
    `/account/bookings/${booking("completed", "emeka@demo.ng")}/review`,
    `/account/bookings/${booking("confirmed", "emeka@demo.ng")}`,
    `/account/bookings/${booking("disputed", "emeka@demo.ng")}`,
    `/account/bookings/${booking("confirmed", "emeka@demo.ng")}/dispute`,
  ],
  "owner@demo.ng": [
    "/business",
    "/business/bookings",
    `/business/bookings/${bizBooking}`,
    "/business/messages",
    `/business/messages/${bizConvo}`,
    "/business/services",
    "/business/availability",
    "/business/profile",
    "/business/earnings",
    "/business/reviews",
    "/business/plan",
    "/business/promote",
    "/business/verification",
  ],
};

const findings = [];
for (const [who, paths] of Object.entries(routes)) {
  const p = await as(who === "visitor" ? null : who);
  for (const path of paths) {
    await p.goto(base + path);
    await p.waitForLoadState("networkidle").catch(() => {});
    const report = await p.evaluate(() => {
      const W = window.innerWidth;
      const out = {
        overflow: document.documentElement.scrollWidth - W,
        wide: [],
        smallInputs: [],
        smallTargets: [],
      };
      const scrollsX = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) return true;
        }
        return false;
      };
      const name = (el) =>
        `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 40)}"`;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > W + 1 && !scrollsX(el)) out.wide.push(`${name(el)} right=${Math.round(r.right)}`);
      }
      for (const el of document.querySelectorAll(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea",
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) out.smallInputs.push(`${name(el)} ${size}px`);
      }
      for (const el of document.querySelectorAll(
        "button, [role=button], a, input[type=checkbox], input[type=radio], summary",
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const s = getComputedStyle(el);
        if (el.tagName === "A" && s.display === "inline" && el.closest("p, li span, dd")) continue; // links in a sentence
        if (r.height < 32 || r.width < 24)
          out.smallTargets.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      out.wide = out.wide.slice(0, 5);
      out.smallTargets = [...new Set(out.smallTargets)].slice(0, 8);
      return out;
    });
    const file = `${who.split("@")[0]}${path.replace(/[/?=&,]/g, "_").slice(0, 60)}`;
    await p.screenshot({ path: `${shots}/${file}.png`, fullPage: true });
    const problems = [];
    if (report.overflow > 0) problems.push(`page scrolls sideways by ${report.overflow}px`);
    if (report.wide.length) problems.push(`wider than screen: ${report.wide.join("; ")}`);
    if (report.smallInputs.length)
      problems.push(`inputs under 16px (iOS zooms): ${report.smallInputs.join("; ")}`);
    if (report.smallTargets.length) problems.push(`small tap targets: ${report.smallTargets.join("; ")}`);
    findings.push(
      `${problems.length ? "ISSUE" : "OK   "} ${who} ${path} -> ${file}.png${problems.map((x) => "\n   - " + x).join("")}`,
    );
  }
}
await browser.close();
console.log(findings.join("\n"));
