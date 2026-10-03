#!/usr/bin/env node
// Fails if a committed file contains something that looks like a real secret: payment, AI, email
// or Supabase keys, private keys, or a filled-in secret in a committed .env file. Runs in CI on every
// push (npm run check:secrets). Real values belong in the hosting provider's settings or .env.local,
// which git ignores. A line that is a deliberate example can end with "secret-scan: allow".

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const patterns = [
  ["Paystack secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{20,}/],
  ["Flutterwave secret key", /\bFLWSECK(?:_TEST)?-[A-Za-z0-9]{20,}/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["Resend API key", /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  [
    "JSON web token (Supabase keys are these)",
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  ],
  ["Private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
];

// Server-only settings that must never have a value in a committed env file.
const secretNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "PAYSTACK_SECRET_KEY",
  "FLUTTERWAVE_SECRET_KEY",
  "FLUTTERWAVE_WEBHOOK_HASH",
  "CRON_SECRET",
  "RESEND_API_KEY",
];

/** Problems in one file's text: [{ line, what }]. */
export function findSecrets(path, text) {
  const found = [];
  // .env.test holds dummy values for unit tests only; key-shaped values are still caught there.
  const envFile = /(^|\/)\.env(\.|$)/.test(path) && !path.endsWith(".env.test");
  const names = path.endsWith(".env.production") ? [...secretNames, "ADMIN_PATH"] : secretNames;
  text.split("\n").forEach((line, index) => {
    if (line.includes("secret-scan: allow")) return;
    for (const [what, pattern] of patterns) if (pattern.test(line)) found.push({ line: index + 1, what });
    const assignment = envFile && line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S.*)$/);
    if (assignment && names.includes(assignment[1]))
      found.push({ line: index + 1, what: `${assignment[1]} has a value in a committed env file` });
  });
  return found;
}

function main() {
  // Tracked files plus staged ones, so it also works as a pre-commit check.
  const files = execFileSync("git", ["ls-files", "-z", "--cached"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const problems = [];
  for (const path of files) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // deleted in the working tree
    }
    if (text.includes("\0")) continue; // binary
    // Only the file, line and kind are printed, never the value itself.
    for (const { line, what } of findSecrets(path, text)) problems.push(`${path}:${line}  ${what}`);
  }
  if (problems.length) {
    console.error(`Possible secrets in the repository:\n  ${problems.join("\n  ")}`);
    console.error(
      "\nMove the value to the hosting provider's settings or .env.local, and rotate it: it is in git history.",
    );
    process.exit(1);
  }
  console.log(`No secrets found in ${files.length} files.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
