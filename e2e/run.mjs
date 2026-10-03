#!/usr/bin/env node
// Browser end-to-end suites. Each suite runs against a freshly reset local database and a
// production build (`npm run build` first), and prints one PASS or FAIL line per check.
//
//   npm run test:e2e                 every suite
//   npm run test:e2e -- booking chat only these
//
// Needs the local Supabase stack (`npm run db:start`) and Chromium for Playwright
// (`npx playwright install chromium`). Settings come from the environment, then .env.local.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const suitesDir = join(root, "e2e", "suites");
const port = process.env.E2E_PORT ?? "3000";

// .env.local fills in anything not already set (CI sets everything itself).
const envFile = join(root, ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
process.env.E2E_BASE_URL ??= `http://localhost:${port}`;
process.env.E2E_SHOTS ??= join(root, "e2e", "screenshots");

// A 6 MB JPEG for the "too large" upload checks; generated rather than committed.
const big = join(root, "e2e", "fixtures", "big.jpg");
if (!existsSync(big)) {
  const bytes = Buffer.alloc(6_000_000);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  writeFileSync(big, bytes);
}
mkdirSync(process.env.E2E_SHOTS, { recursive: true });

const all = readdirSync(suitesDir)
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => file.replace(/\.mjs$/, ""))
  .sort();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !all.includes(name));
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(", ")}. Suites: ${all.join(", ")}`);
  process.exit(2);
}
const suites = wanted.length ? wanted : all;

async function waitForServer(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The app did not start on ${url}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

const summary = [];
let failed = false;
for (const suite of suites) {
  // Every suite starts from the seed data, and with a fresh server (some limits are kept in memory).
  run("npx", ["supabase", "db", "reset"]);
  const server = spawn("npx", ["next", "start", "-p", port], { cwd: root, env: process.env, detached: true });
  let serverLog = "";
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  try {
    await waitForServer(process.env.E2E_BASE_URL);
    const started = Date.now();
    const result = spawnSync("node", [join(suitesDir, `${suite}.mjs`)], {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      timeout: 15 * 60_000,
    });
    const lines = `${result.stdout}${result.stderr}`.split("\n");
    const passes = lines.filter((line) => line.startsWith("PASS")).length;
    const failures = lines.filter((line) => line.startsWith("FAIL"));
    const ok = result.status === 0 && failures.length === 0 && passes > 0;
    if (!ok) {
      failed = true;
      console.log(`\n✗ ${suite}`);
      for (const line of failures.length ? failures : lines.slice(-30)) console.log(`  ${line}`);
      if (result.status !== 0 && process.env.CI) console.log(serverLog.split("\n").slice(-40).join("\n"));
    }
    summary.push(
      `${ok ? "✓" : "✗"} ${suite.padEnd(14)} ${passes} passed, ${failures.length} failed (${Math.round((Date.now() - started) / 1000)}s)`,
    );
    console.log(summary.at(-1));
  } finally {
    try {
      process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
}
console.log(`\n${summary.join("\n")}`);
process.exit(failed ? 1 : 0);
