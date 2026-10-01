import { CalendarDays, ChevronLeft, MapPin, MessageCircle, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookingHistory } from "@/components/bookings/booking-history";
import { BookingResponse } from "@/components/business/booking-response";
import { BusinessBookingStatus } from "@/components/business/business-booking-list";
import { DisputeStatus } from "@/components/disputes/dispute-status";
import { ReportProblemForm } from "@/components/disputes/report-problem";
import { LinkButton } from "@/components/ui";
import { canOpenDispute } from "@/lib/admin/rules";
import { getBusinessBooking } from "@/lib/business/booking-queries";
import { formatBookingLocation, itemKindLabels } from "@/lib/bookings/workflow";
import { businessBookingActions } from "@/lib/business/booking-rules";
import { commissionFor, paidStatuses } from "@/lib/business/earnings";
import { requireOwnBusiness } from "@/lib/business/queries";
import { formatDateTime, formatNaira } from "@/lib/format";

export const metadata: Metadata = { title: "Booking" };

export default async function BusinessBookingPage({ params }: PageProps<"/business/bookings/[id]">) {
  const { business } = await requireOwnBusiness();
  const { id } = await params;
  const booking = await getBusinessBooking(id, business.id);
  if (!booking) notFound();

  const actions = businessBookingActions(booking.status, booking.needs_quote);
  const commission = commissionFor(booking.total_minor, booking.commission_rate_bps);
  const isPaid = paidStatuses.includes(booking.status);
  const conversationId = booking.conversations?.id ?? null;
  const dispute = booking.disputes.toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const location = formatBookingLocation(booking);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/business/bookings"
        className="inline-flex items-center gap-1 text-sm text-muted hover:underline"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Bookings
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{booking.customerName}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <BusinessBookingStatus status={booking.status} />
          <span>Booking ID {booking.reference}</span>
          {booking.needs_quote && booking.status === "pending_provider" && <span>· Quote requested</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
        <p className="flex items-center gap-2">
          <CalendarDays aria-hidden className="size-4 text-muted" />
          {booking.scheduled_start ? formatDateTime(booking.scheduled_start) : "Date to be agreed"}
        </p>
        {location && (
          <p className="flex items-center gap-2">
            <MapPin aria-hidden className="size-4 text-muted" />
            {location}
          </p>
        )}
        {booking.guests && (
          <p className="flex items-center gap-2">
            <Users aria-hidden className="size-4 text-muted" />
            {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
          </p>
        )}
        {booking.customer_notes && (
          <div className="rounded-xl bg-surface-muted p-3">
            <p className="font-medium">Additional requirements</p>
            <p className="mt-1 whitespace-pre-line text-muted">{booking.customer_notes}</p>
          </div>
        )}
        {booking.cancellation_reason && (
          <p className="text-muted">
            <span className="font-medium text-foreground">Reason: </span>
            {booking.cancellation_reason}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-sm">
        <h2 className="font-semibold">Summary</h2>
        {booking.booking_items.length > 0 ? (
          booking.booking_items.map((item) => (
            <div key={item.id} className="flex justify-between gap-3">
              <span>
                {item.name}
                {item.quantity > 1 && ` × ${item.quantity}`}
                {itemKindLabels[item.kind] && (
                  <span className="text-xs text-muted"> · {itemKindLabels[item.kind]}</span>
                )}
              </span>
              <span>{formatNaira(item.total_minor ?? item.unit_price_minor * item.quantity)}</span>
            </div>
          ))
        ) : (
          <p className="text-muted">Quote request, no services selected.</p>
        )}
        {booking.quote_notes && <p className="text-muted">Your quote: {booking.quote_notes}</p>}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
          <span>Customer pays</span>
          <span>{booking.total_minor > 0 ? formatNaira(booking.total_minor) : "To be quoted"}</span>
        </div>
        {booking.total_minor > 0 && (
          <>
            <div className="flex justify-between text-muted">
              <span>Platform commission ({booking.commission_rate_bps / 100}%)</span>
              <span>− {formatNaira(commission)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>You receive</span>
              <span>{formatNaira(booking.total_minor - commission)}</span>
            </div>
          </>
        )}
        <p className="text-muted">
          {isPaid ? "The customer has paid on Concierge." : "Customers pay on Concierge after you accept."}
        </p>
      </div>

      {conversationId && (
        <LinkButton href={`/business/messages/${conversationId}`} variant="outline" className="self-start">
          <MessageCircle aria-hidden className="size-4" />
          Message {booking.customerName}
        </LinkButton>
      )}

      <BookingResponse bookingId={booking.id} actions={actions} />
      {dispute && (
        <DisputeStatus
          dispute={dispute}
          viewer="business"
          href={`/business/bookings/${booking.id}/dispute`}
        />
      )}
      {!dispute && canOpenDispute(booking) && (
        <ReportProblemForm bookingId={booking.id} otherParty={booking.customerName} />
      )}
      <BookingHistory
        events={booking.booking_events}
        viewer="business"
        names={{ customer: booking.customerName, business: business.name }}
      />
    </div>
  );
}
