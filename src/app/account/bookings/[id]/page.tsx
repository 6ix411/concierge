import { CalendarDays, MapPin, MessageCircle, Star, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormMessage } from "@/components/auth/form-message";
import { AcceptQuoteForm, CancelBookingForm, RescheduleForm } from "@/components/bookings/booking-actions";
import { BookingHistory } from "@/components/bookings/booking-history";
import { BookingProgress } from "@/components/bookings/booking-progress";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { DisputeStatus } from "@/components/disputes/dispute-status";
import { ReportProblemForm } from "@/components/disputes/report-problem";
import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { Stars } from "@/components/marketplace/rating";
import { VerifiedBadge } from "@/components/marketplace/verified-badge";
import { LinkButton } from "@/components/ui";
import { amountPaid, canOpenDispute } from "@/lib/admin/rules";
import { requireAreaAccess } from "@/lib/auth/session";
import { getCustomerBooking } from "@/lib/bookings/queries";
import {
  canCustomerAcceptQuote,
  canCustomerCancel,
  canCustomerPay,
  canCustomerReschedule,
  canMessage,
  canReview,
} from "@/lib/bookings/rules";
import { formatBookingLocation, itemKindLabels } from "@/lib/bookings/workflow";
import { addDays, lagosToday, toLagosParts } from "@/lib/dates";
import { formatDateTime, formatNaira } from "@/lib/format";

export const metadata: Metadata = { title: "Booking" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  sent: { tone: "success", text: "Request sent. We’ll notify you when the business responds." },
  success: {
    tone: "success",
    text: "Payment received. Your booking is confirmed and you can now message the business.",
  },
  failed: {
    tone: "error",
    text: "Your payment didn’t go through. You haven’t been charged; please try again.",
  },
  reviewed: { tone: "success", text: "Thanks for your review." },
};

export default async function BookingDetailPage({
  params,
  searchParams,
}: PageProps<"/account/bookings/[id]">) {
  const user = await requireAreaAccess("account");
  const { id } = await params;
  const query = await searchParams;
  const booking = await getCustomerBooking(user.id, id);
  if (!booking) notFound();

  const noticeKey = query.sent
    ? "sent"
    : query.reviewed
      ? "reviewed"
      : typeof query.payment === "string"
        ? query.payment
        : null;
  const notice = noticeKey ? notices[noticeKey] : undefined;
  const paid = booking.payments.some((p) => p.status === "success" || p.status === "refunded");
  const refundDue = booking.status === "cancelled" ? amountPaid(booking.payments) : 0;
  const dispute = booking.disputes.toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const today = lagosToday();
  const current = booking.scheduled_start ? toLagosParts(booking.scheduled_start) : undefined;
  const location = formatBookingLocation(booking);
  const reached = booking.booking_events.flatMap((event) => (event.to_status ? [event.to_status] : []));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        {notice && <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Booking {booking.reference}</h1>
            <BookingStatusBadge status={booking.status} />
          </div>
          {booking.businesses && (
            <Link href={`/businesses/${booking.businesses.slug}`} className="flex items-center gap-3">
              <BusinessAvatar
                name={booking.businesses.name}
                logoPath={booking.businesses.logo_path}
                size="sm"
              />
              <span className="font-medium hover:underline">{booking.businesses.name}</span>
              {booking.businesses.is_verified && <VerifiedBadge />}
            </Link>
          )}
        </header>

        <BookingProgress status={booking.status} reached={reached} />
        {refundDue > 0 && (
          <FormMessage tone="success">
            {formatNaira(refundDue)} is due back to you. We’ll let you know when the refund is sent.
          </FormMessage>
        )}

        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
          <p className="flex items-start gap-2">
            <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
            {booking.scheduled_start ? formatDateTime(booking.scheduled_start) : "Date to be agreed"}
          </p>
          {location && (
            <p className="flex items-start gap-2">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
              {location}
            </p>
          )}
          {booking.guests && (
            <p className="flex items-start gap-2">
              <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
              {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
            </p>
          )}
          {booking.customer_notes && (
            <div>
              <p className="text-muted">Additional requirements</p>
              <p className="whitespace-pre-line">{booking.customer_notes}</p>
            </div>
          )}
          {booking.quote_notes && (
            <div className="rounded-xl bg-accent/10 p-3">
              <p className="font-medium">Quote from the business</p>
              <p className="whitespace-pre-line">{booking.quote_notes}</p>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-sm">
          <h2 className="font-semibold">Summary</h2>
          {booking.booking_items.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {booking.booking_items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>
                    {item.name}
                    {item.quantity > 1 && <span className="text-muted"> × {item.quantity}</span>}
                    {itemKindLabels[item.kind] && (
                      <span className="text-xs text-muted"> · {itemKindLabels[item.kind]}</span>
                    )}
                  </span>
                  <span>{item.unit_price_minor > 0 ? formatNaira(item.total_minor ?? 0) : "Quote"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Custom quote request</p>
          )}
          <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
            <span>
              {booking.needs_quote && ["pending_provider", "quoted"].includes(booking.status)
                ? "Estimate"
                : "Total"}
            </span>
            <span>{booking.total_minor > 0 ? formatNaira(booking.total_minor) : "To be quoted"}</span>
          </div>
          {paid && (
            <p className="text-verified">{booking.status === "refunded" ? "Paid, then refunded" : "Paid"}</p>
          )}
        </section>

        {booking.reviews && (
          <section className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-sm">
            <span>Your rating</span>
            <Stars value={booking.reviews.rating} />
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-3">
        {canCustomerPay(booking) && (
          <LinkButton href={`/checkout/${booking.id}`} size="lg">
            Pay {formatNaira(booking.total_minor)}
          </LinkButton>
        )}
        {canCustomerAcceptQuote(booking) && (
          <AcceptQuoteForm
            bookingId={booking.id}
            label={`Accept quote · ${formatNaira(booking.total_minor)}`}
          />
        )}
        {canMessage(booking) && booking.conversations && (
          <LinkButton href={`/account/messages/${booking.conversations.id}`} variant="outline" size="lg">
            <MessageCircle aria-hidden className="size-4" />
            Message {booking.businesses?.name ?? "business"}
          </LinkButton>
        )}
        {canReview({ ...booking, hasReview: Boolean(booking.reviews) }) && (
          <LinkButton href={`/account/bookings/${booking.id}/review`} variant="accent" size="lg">
            <Star aria-hidden className="size-4" />
            Leave a review
          </LinkButton>
        )}
        {canCustomerReschedule(booking) && (
          <RescheduleForm
            bookingId={booking.id}
            minDate={addDays(today, 1)}
            maxDate={addDays(today, 365)}
            defaultDate={current?.date}
            defaultTime={current?.time}
          />
        )}
        {canCustomerCancel(booking) && <CancelBookingForm bookingId={booking.id} afterPayment={paid} />}
        {dispute && <DisputeStatus dispute={dispute} viewer="customer" />}
        {!dispute && canOpenDispute(booking) && (
          <ReportProblemForm bookingId={booking.id} otherParty={booking.businesses?.name ?? "the business"} />
        )}

        <BookingHistory
          events={booking.booking_events}
          viewer="customer"
          names={{ customer: "You", business: booking.businesses?.name ?? "The business" }}
        />
      </aside>
    </div>
  );
}
