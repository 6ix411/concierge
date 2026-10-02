import { NextResponse, type NextRequest } from "next/server";

import { paymentProviderSchema } from "@/lib/env/schema";
import { getPaymentProvider } from "@/lib/payments";
import { handleWebhook } from "@/lib/payments/webhooks";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Payment providers post events here (set the URL in the Paystack or Flutterwave dashboard):
 * /api/payments/webhook/paystack or /api/payments/webhook/flutterwave.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/payments/webhook/[provider]">) {
  const name = paymentProviderSchema.safeParse((await ctx.params).provider);
  if (!name.success) return NextResponse.json({ received: false }, { status: 404 });

  let provider;
  try {
    provider = getPaymentProvider(name.data);
  } catch {
    // Not configured here (or the mock provider in production).
    return NextResponse.json({ received: false }, { status: 404 });
  }

  if (!(await checkRateLimit("payment.webhook")))
    return NextResponse.json({ received: false }, { status: 429 });
  // Refuse oversized bodies before reading them, and check the real size in bytes after.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return NextResponse.json({ received: false }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES)
    return NextResponse.json({ received: false }, { status: 413 });

  const { status, body } = await handleWebhook(provider, rawBody, request.headers);
  return NextResponse.json(body, { status });
}
