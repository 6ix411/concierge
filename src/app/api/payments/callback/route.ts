import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/errors";
import { finalizePayment } from "@/lib/payments/checkout";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** Payment providers send the customer back here after checkout. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Paystack uses ?reference=, Flutterwave uses ?tx_ref=.
  const reference = params.get("reference") ?? params.get("tx_ref") ?? params.get("trxref");
  if (!reference || !/^PAY-[A-F0-9]{16}$/.test(reference)) {
    return NextResponse.redirect(new URL("/account/bookings?payment=invalid", request.url));
  }
  // Each visit asks the provider to verify the payment, so it can't be hammered.
  if (!(await checkRateLimit("payment.callback")))
    return NextResponse.redirect(new URL("/account/bookings?payment=error", request.url));
  try {
    const { bookingId, paid } = await finalizePayment(reference);
    return NextResponse.redirect(
      new URL(`/account/bookings/${bookingId}?payment=${paid ? "success" : "failed"}`, request.url),
    );
  } catch (error) {
    logger.error("Payment callback failed", { reference, error });
    return NextResponse.redirect(new URL("/account/bookings?payment=error", request.url));
  }
}
