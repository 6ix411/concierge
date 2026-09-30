import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CheckoutButton } from "@/components/bookings/checkout-button";
import { Container } from "@/components/layout/container";
import { requireAreaAccess } from "@/lib/auth/session";
import { canCustomerPay } from "@/lib/bookings/rules";
import { formatDateTime, formatNaira } from "@/lib/format";
import { startCheckoutAction } from "@/lib/payments/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: PageProps<"/checkout/[bookingId]">) {
  const user = await requireAreaAccess("account");
  const { bookingId } = await params;
  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, reference, status, scheduled_start, subtotal_minor, platform_fee_minor, total_minor, city, businesses(name), booking_items(id, name, unit_price_minor, quantity, total_minor)",
    )
    .eq("id", bookingId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!booking) notFound();
  if (!canCustomerPay(booking)) redirect(`/account/bookings/${booking.id}`);

  return (
    <Container className="flex max-w-xl flex-col gap-6 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
        <p className="mt-1 text-muted">
          {booking.businesses?.name} ·{" "}
          {booking.scheduled_start ? formatDateTime(booking.scheduled_start) : "Date to be agreed"}
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <ul className="flex flex-col gap-2 text-sm">
          {booking.booking_items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                {item.name}
                {item.quantity > 1 && <span className="text-muted"> × {item.quantity}</span>}
              </span>
              <span>{formatNaira(item.total_minor ?? 0)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span>{formatNaira(booking.subtotal_minor)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Service fee</span>
            <span>{booking.platform_fee_minor > 0 ? formatNaira(booking.platform_fee_minor) : "Free"}</span>
          </div>
          <div className="flex justify-between pt-1 text-base font-semibold">
            <span>Total</span>
            <span>{formatNaira(booking.total_minor)}</span>
          </div>
        </div>
        <p className="text-xs text-muted">Reference {booking.reference}</p>
      </section>

      <CheckoutButton
        action={startCheckoutAction.bind(null, booking.id)}
        label={`Pay ${formatNaira(booking.total_minor)} securely`}
      />
      <p className="flex items-start gap-2 text-sm text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
        You pay through Concierge, so your booking is covered by our platform rules. Card details are handled
        by our payment partner and never stored by us.
      </p>
    </Container>
  );
}
