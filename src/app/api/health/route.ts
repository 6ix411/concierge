import { NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/errors/http";
import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Can the app reach its database? One tiny read, given up after three seconds. */
async function databaseStatus(): Promise<"ok" | "down"> {
  try {
    const { error } = await createAdminClient()
      .from("platform_settings")
      .select("key", { head: true, count: "exact" })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000));
    if (error) throw error;
    return "ok";
  } catch (error) {
    logger.error("Health check: database unreachable", { error });
    return "down";
  }
}

/**
 * Health check for hosting and uptime monitors: 200 when the app and its database are up, 503
 * otherwise. Reports which services are configured, never their values.
 */
export const GET = withErrorHandling(async () => {
  const configured = (key: string) => Boolean(process.env[key]);
  const database = await databaseStatus();
  return NextResponse.json(
    {
      status: database === "ok" ? "ok" : "degraded",
      env: process.env.APP_ENV ?? "development",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      database,
      services: {
        supabase: configured("NEXT_PUBLIC_SUPABASE_URL") && configured("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        ai: configured("ANTHROPIC_API_KEY"),
        payments: configured("PAYSTACK_SECRET_KEY") || configured("FLUTTERWAVE_SECRET_KEY"),
        email: configured("RESEND_API_KEY") && configured("EMAIL_FROM"),
        notificationJob: configured("CRON_SECRET"),
      },
    },
    { status: database === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
});
