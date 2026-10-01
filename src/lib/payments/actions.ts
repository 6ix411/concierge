"use server";

import type { FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { canCustomerPay } from "@/lib/bookings/rules";
import { moveBooking } from "@/lib/bookings/transitions";
import { isAppError, logger } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

import { startPayment } from "./checkout";

export type CheckoutState = FormState & { redirectTo?: string };

/**
 * Starts payment and returns the provider's checkout page. The browser goes there with a full page
 * load: a router navigation would keep our callback URL in the address bar after the redirect back.
 */
export async function startCheckoutAction(bookingId: string, _prev: CheckoutState): Promise<CheckoutState> {
  try {
    const customer = await requireRole("customer");
    const supabase = await createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, scheduled_start, total_minor, business_id, commission_rate_bps")
      .eq("id", bookingId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!booking || !canCustomerPay(booking) || booking.total_minor <= 0) {
      return { status: "error", message: "This booking isn't ready for payment." };
    }
    // The first payment attempt moves the booking to payment pending; retries keep it there.
    if (booking.status === "accepted") {
      await moveBooking({
        bookingId: booking.id,
        from: "accepted",
        to: "payment_pending",
        actorId: customer.id,
        scope: { customerId: customer.id },
      });
    }
    return { status: "success", redirectTo: await startPayment(booking, customer) };
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { status: "error", message: error.message };
    logger.error("Checkout failed", { error });
    return { status: "error", message: "We couldn't start the payment. Please try again." };
  }
}
