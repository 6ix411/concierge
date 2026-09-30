import { parseEnv, publicEnvSchema, type PublicEnv } from "./schema";

let cached: PublicEnv | undefined;

/**
 * Validated public (browser-safe) environment.
 * Each variable is referenced literally so Next.js can inline it at build time.
 */
export function getPublicEnv(): PublicEnv {
  cached ??= parseEnv(
    publicEnvSchema,
    {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
      NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY: process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY,
    },
    "public",
  );
  return cached;
}
