import { describe, expect, it } from "vitest";

import { findSecrets } from "../scripts/check-secrets.mjs";

// Built from parts so this file doesn't trip the scanner itself.
const fake = (...parts: string[]) => parts.join("");

describe("secret scan", () => {
  it("finds key-shaped values in any file", () => {
    const text = [
      `const key = "${fake("sk_", "live_", "a".repeat(30))}";`,
      `ANTHROPIC = ${fake("sk-", "ant-", "b".repeat(30))}`,
      `resend: ${fake("re_", "abcdef12", "_", "c".repeat(20))}`,
      fake("-----BEGIN ", "PRIVATE KEY-----"),
      fake("eyJ", "a".repeat(20), ".eyJ", "b".repeat(20), ".", "c".repeat(20)),
    ].join("\n");
    expect(findSecrets("src/x.ts", text).map((f) => f.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores placeholders, short test values and allowed examples", () => {
    const text = [
      'PAYSTACK_SECRET_KEY: "sk_test_x"',
      "Live secret key `sk_live_…`",
      `${fake("sk_", "live_", "a".repeat(30))} // secret-scan: allow`,
    ].join("\n");
    expect(findSecrets("README.md", text)).toEqual([]);
  });

  it("refuses filled-in secrets in committed env files but allows blanks and public values", () => {
    const text = ["CRON_SECRET=", "SUPABASE_SERVICE_ROLE_KEY=abc", "NEXT_PUBLIC_APP_URL=https://x.ng"].join(
      "\n",
    );
    expect(findSecrets(".env.example", text)).toEqual([
      { line: 2, what: "SUPABASE_SERVICE_ROLE_KEY has a value in a committed env file" },
    ]);
    expect(findSecrets(".env.development", "ADMIN_PATH=admin-local-dev-only")).toEqual([]);
    expect(findSecrets(".env.production", "ADMIN_PATH=abc")).toHaveLength(1);
    expect(findSecrets(".env.test", "CRON_SECRET=dummy")).toEqual([]);
    expect(
      findSecrets(".env.test", `PAYSTACK_SECRET_KEY=${fake("sk_", "live_", "a".repeat(30))}`),
    ).toHaveLength(1);
  });
});
