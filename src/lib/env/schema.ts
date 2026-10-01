import { z } from "zod";

/**
 * Environment schemas. Kept free of `server-only` so they can be unit tested;
 * the server-side accessor lives in `./server.ts`.
 */

export const appEnvSchema = z.enum(["development", "test", "production"]);
export type AppEnv = z.infer<typeof appEnvSchema>;

/** "mock" confirms payments instantly for local development and tests. It is refused in production. */
export const paymentProviderSchema = z.enum(["paystack", "flutterwave", "mock"]);
export type PaymentProviderName = z.infer<typeof paymentProviderSchema>;

/** Values that are safe to ship to the browser (NEXT_PUBLIC_*). */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Secrets and server configuration. Never exposed to the client. */
export const serverEnvSchema = publicEnvSchema
  .extend({
    APP_ENV: appEnvSchema.default("development"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // Optional until the AI stage; the concierge falls back to platform search without it.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
    PAYMENT_PROVIDER: paymentProviderSchema.default("paystack"),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    FLUTTERWAVE_SECRET_KEY: z.string().optional(),
    FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),
    // Lets a scheduler call /api/notifications/dispatch (email/SMS/push). Unset: the route is off.
    CRON_SECRET: z.string().min(32, "Use at least 32 characters (e.g. openssl rand -hex 32)").optional(),
    // Private URL segment for the admin dashboard. Generate with: openssl rand -hex 16
    ADMIN_PATH: z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,64}$/, "Use 16-64 letters, numbers, - or _ (e.g. openssl rand -hex 16)")
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === "paystack" && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYSTACK_SECRET_KEY"],
        message: "Required when PAYMENT_PROVIDER=paystack",
      });
    }
    if (env.PAYMENT_PROVIDER === "flutterwave" && !env.FLUTTERWAVE_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["FLUTTERWAVE_SECRET_KEY"],
        message: "Required when PAYMENT_PROVIDER=flutterwave",
      });
    }
    if (env.APP_ENV === "production" && env.PAYMENT_PROVIDER === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: "mock payments are not allowed in production",
      });
    }
    if (env.APP_ENV === "production" && !env.ADMIN_PATH) {
      ctx.addIssue({ code: "custom", path: ["ADMIN_PATH"], message: "Required when APP_ENV=production" });
    }
    if (env.APP_ENV === "production") {
      const testKey = [env.PAYSTACK_SECRET_KEY, env.FLUTTERWAVE_SECRET_KEY].some(
        (key) => key !== undefined && /(^sk_test_|_TEST-)/.test(key),
      );
      if (testKey) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_ENV"],
          message: "Test payment keys must not be used when APP_ENV=production",
        });
      }
    }
  });
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parses `source`, throwing one readable error that lists every problem (names only, never values). */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  // Treat empty strings as unset so blank lines copied from .env.example fail clearly.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} environment variables:\n${problems}`);
  }
  return result.data;
}
