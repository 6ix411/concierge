import { describe, expect, it } from "vitest";

import { parseEnv, serverEnvSchema } from "./schema";

const base = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  ANTHROPIC_API_KEY: "key",
  PAYSTACK_SECRET_KEY: "sk_test_x",
};

const live = {
  APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://concierge.ng",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  PAYSTACK_SECRET_KEY: "sk_live_x",
  ADMIN_PATH: "a1b2c3d4e5f6a7b8c9d0",
  CRON_SECRET: "c".repeat(64),
};

describe("server env", () => {
  it("applies defaults", () => {
    const env = parseEnv(serverEnvSchema, base, "server");
    expect(env.APP_ENV).toBe("development");
    expect(env.PAYMENT_PROVIDER).toBe("paystack");
  });

  it("treats blank values as missing and lists names without values", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, SUPABASE_SERVICE_ROLE_KEY: "" }, "server")).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(() => parseEnv(serverEnvSchema, { ...base, SUPABASE_SERVICE_ROLE_KEY: "" }, "server")).not.toThrow(
      /sk_test_x/,
    );
  });

  it("requires the selected provider's secret", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, PAYMENT_PROVIDER: "flutterwave" }, "server")).toThrow(
      /FLUTTERWAVE_SECRET_KEY/,
    );
  });

  it("requires a private admin path in production", () => {
    expect(() =>
      parseEnv(
        serverEnvSchema,
        { ...base, APP_ENV: "production", PAYSTACK_SECRET_KEY: "sk_live_x" },
        "server",
      ),
    ).toThrow(/ADMIN_PATH/);
  });

  it("rejects test payment keys in production", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, APP_ENV: "production" }, "server")).toThrow(
      /Test payment keys/,
    );
    expect(() => parseEnv(serverEnvSchema, { ...base, ...live }, "server")).not.toThrow();
  });

  it("requires the AI key, the cron secret and https in production", () => {
    for (const key of ["ANTHROPIC_API_KEY", "CRON_SECRET"] as const) {
      expect(() => parseEnv(serverEnvSchema, { ...base, ...live, [key]: undefined }, "server")).toThrow(
        new RegExp(key),
      );
    }
    expect(() =>
      parseEnv(serverEnvSchema, { ...base, ...live, NEXT_PUBLIC_APP_URL: "http://concierge.ng" }, "server"),
    ).toThrow(/NEXT_PUBLIC_APP_URL: Must use https/);
    expect(() =>
      parseEnv(serverEnvSchema, { ...base, ...live, NEXT_PUBLIC_SUPABASE_URL: "http://db.local" }, "server"),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL: Must use https/);
  });

  it("needs both email settings or neither", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, RESEND_API_KEY: "re_x" }, "server")).toThrow(
      /EMAIL_FROM/,
    );
    expect(() => parseEnv(serverEnvSchema, { ...base, EMAIL_FROM: "a@b.ng" }, "server")).toThrow(
      /RESEND_API_KEY/,
    );
    expect(() =>
      parseEnv(serverEnvSchema, { ...base, RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.ng" }, "server"),
    ).not.toThrow();
  });
});
