"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { canCustomerPay } from "@/lib/bookings/rules";
import { isAppError, logger } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

import { startPayment } from "./checkout";

export async function startCheckoutAction(bookingId: string, _prev: FormState): Promise<FormState> {
  let url: string;
  try {
    const customer = await requireRole("customer");
    const supabase = await createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, status, scheduled_start, total_minor")
      .eq("id", bookingId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!booking || !canCustomerPay(booking) || booking.total_minor <= 0) {
      return { status: "error", message: "This booking isn't ready for payment." };
    }
    url = await startPayment(booking, customer);
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { status: "error", message: error.message };
    logger.error("Checkout failed", { error });
    return { status: "error", message: "We couldn't start the payment. Please try again." };
  }
  redirect(url);
}
