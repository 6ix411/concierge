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

describe("server env", () => {
  it("applies defaults", () => {
    const env = parseEnv(serverEnvSchema, base, "server");
    expect(env.APP_ENV).toBe("development");
    expect(env.PAYMENT_PROVIDER).toBe("paystack");
  });

  it("treats blank values as missing and lists names without values", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, ANTHROPIC_API_KEY: "" }, "server")).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => parseEnv(serverEnvSchema, { ...base, ANTHROPIC_API_KEY: "" }, "server")).not.toThrow(
      /service/,
    );
  });

  it("requires the selected provider's secret", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, PAYMENT_PROVIDER: "flutterwave" }, "server")).toThrow(
      /FLUTTERWAVE_SECRET_KEY/,
    );
  });

  it("rejects test payment keys in production", () => {
    expect(() => parseEnv(serverEnvSchema, { ...base, APP_ENV: "production" }, "server")).toThrow(
      /Test payment keys/,
    );
    expect(() =>
      parseEnv(
        serverEnvSchema,
        { ...base, APP_ENV: "production", PAYSTACK_SECRET_KEY: "sk_live_x" },
        "server",
      ),
    ).not.toThrow();
  });
});
