import { NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/errors/http";

export const dynamic = "force-dynamic";

/** Liveness check for hosting and uptime monitors. Reports configuration presence, never values. */
export const GET = withErrorHandling(async () => {
  const configured = (key: string) => Boolean(process.env[key]);
  return NextResponse.json({
    status: "ok",
    env: process.env.APP_ENV ?? "development",
    services: {
      supabase: configured("NEXT_PUBLIC_SUPABASE_URL") && configured("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      ai: configured("ANTHROPIC_API_KEY"),
      payments: configured("PAYSTACK_SECRET_KEY") || configured("FLUTTERWAVE_SECRET_KEY"),
    },
  });
});
