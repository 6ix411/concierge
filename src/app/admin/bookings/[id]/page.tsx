import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { Panel } from "@/components/admin/dashboard-widgets";
import { BookingHistory } from "@/components/bookings/booking-history";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { Badge } from "@/components/ui";
import { adminBookingAction } from "@/lib/admin/booking-actions";
import { adminBookingActionsFor, amountPaid, disputeStatusInfo, formatBps } from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { formatBookingLocation, itemKindLabels } from "@/lib/bookings/workflow";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Booking" };

const payoutLabels: Record<string, string> = {
  pending: "Waiting to be paid",
  processing: "Being paid",
  paid: "Paid",
  failed: "Withheld",
  on_hold: "On hold",
};

export default async function AdminBookingPage({ params }: PageProps<"/admin/bookings/[id]">) {
  await requireAreaAccess("admin");
  const { id } = await params;
  // Admin-only page: reads with the service role after the admin check above.
  const db = createAdminClient();
  const { data: booking, error } = await db
    .from("bookings")
    .select(
      `id, reference, status, needs_quote, scheduled_start, scheduled_end, address_line, area, city, state, guests,
       customer_notes, quote_notes,
       subtotal_minor, platform_fee_minor, total_minor, commission_rate_bps, created_at, accepted_at, confirmed_at,
       completed_at, cancelled_at, cancellation_reason,
       business:businesses(id, name, owner_id),
       customer:users!bookings_customer_id_fkey(id, full_name, email),
       cancelled_by_user:users!bookings_cancelled_by_fkey(full_name, role),
       booking_items(id, name, unit_price_minor, quantity, total_minor, kind),
       booking_events(id, event, from_status, to_status, actor_role, note, metadata, created_at),
       payments(id, provider, reference, status, amount_minor, refunded_minor, paid_at, channel, platform_fee_minor, provider_amount_minor, refund_status),
       payouts(id, status, gross_minor, commission_minor, amount_minor, failure_reason, paid_at),
       disputes(id, reason, status, created_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the booking.", { cause: error });
  if (!booking) notFound();

  const refundPending = booking.payments.some((p) => p.refund_status === "pending");
  const refundDue = booking.status === "cancelled" ? amountPaid(booking.payments) : 0;
  const actions = adminBookingActionsFor(booking.status, refundPending ? 0 : refundDue);

  return (
    <div className="flex flex-col gap-6">
      <Link href={adminHref("/bookings")} className="text-sm text-muted hover:underline">
        Bookings
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{booking.reference}</h1>
        <BookingStatusBadge status={booking.status} />
      </div>

      {booking.disputes.length > 0 && (
        <Panel title="Disputes">
          <ul className="flex flex-col gap-2 text-sm">
            {booking.disputes.map((dispute) => (
              <li key={dispute.id} className="flex items-center justify-between gap-3">
                <Link href={adminHref(`/disputes/${dispute.id}`)} className="font-medium hover:underline">
                  {dispute.reason}
                </Link>
                <Badge tone={disputeStatusInfo[dispute.status].tone}>
                  {disputeStatusInfo[dispute.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Manage">
        {actions.length === 0 ? (
          <p className="text-sm text-muted">
            {booking.status === "disputed"
              ? "This booking is disputed. Settle it from the dispute."
              : refundPending
                ? "A refund is on its way to the customer. The booking moves to refunded when the payment provider confirms it."
                : "Nothing to do for a booking in this state."}
          </p>
        ) : (
          <div key={booking.status} className="flex flex-wrap items-start gap-2">
            {actions.includes("complete") && (
              <AdminActionForm
                action={adminBookingAction.bind(null, "complete")}
                fields={{ bookingId: booking.id }}
                label="Mark as completed"
              />
            )}
            {actions.includes("refund") && (
              <AdminActionForm
                action={adminBookingAction.bind(null, "refund")}
                fields={{ bookingId: booking.id }}
                label={`Refund ${formatNaira(refundDue)} to the customer`}
                reason={{ label: "Note for the audit log", required: false }}
              />
            )}
            {actions.includes("cancel") && (
              <AdminActionForm
                action={adminBookingAction.bind(null, "cancel")}
                fields={{ bookingId: booking.id }}
                label="Cancel booking"
                variant="danger"
                reason={{ label: "Reason (both sides will see it)", required: true }}
              />
            )}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Business</dt>
            <dd>
              {booking.business && (
                <Link
                  href={adminHref(`/businesses/${booking.business.id}`)}
                  className="font-medium hover:underline"
                >
                  {booking.business.name}
                </Link>
              )}
            </dd>
            <dt className="text-muted">Customer</dt>
            <dd>
              {booking.customer && (
                <Link
                  href={adminHref(`/users/${booking.customer.id}`)}
                  className="font-medium hover:underline"
                >
                  {booking.customer.full_name ?? booking.customer.email}
                </Link>
              )}
            </dd>
            <dt className="text-muted">When</dt>
            <dd>{booking.scheduled_start ? formatDateTime(booking.scheduled_start) : "Not set"}</dd>
            <dt className="text-muted">Where</dt>
            <dd>{formatBookingLocation(booking) || "Not set"}</dd>
            {booking.guests && (
              <>
                <dt className="text-muted">Guests</dt>
                <dd>{booking.guests}</dd>
              </>
            )}
            {booking.customer_notes && (
              <>
                <dt className="text-muted">Requirements</dt>
                <dd className="whitespace-pre-line">{booking.customer_notes}</dd>
              </>
            )}
            {booking.cancellation_reason && (
              <>
                <dt className="text-muted">Reason</dt>
                <dd>{booking.cancellation_reason}</dd>
              </>
            )}
          </dl>
        </Panel>

        <BookingHistory
          events={booking.booking_events}
          viewer="admin"
          names={{
            customer: booking.customer?.full_name ?? "Customer",
            business: booking.business?.name ?? "Business",
          }}
          className="bg-surface"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Price">
          <ul className="flex flex-col gap-1 text-sm">
            {booking.booking_items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>
                  {item.name}
                  {item.quantity > 1 && ` × ${item.quantity}`}
                  {itemKindLabels[item.kind] && (
                    <span className="text-xs text-muted"> · {itemKindLabels[item.kind]}</span>
                  )}
                </span>
                <span className="tabular-nums">{formatNaira(item.total_minor ?? 0)}</span>
              </li>
            ))}
            {booking.platform_fee_minor > 0 && (
              <li className="flex justify-between gap-3 text-muted">
                <span>Service fee</span>
                <span className="tabular-nums">{formatNaira(booking.platform_fee_minor)}</span>
              </li>
            )}
            <li className="mt-1 flex justify-between gap-3 border-t border-border pt-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatNaira(booking.total_minor)}</span>
            </li>
          </ul>
          <p className="text-xs text-muted">
            Commission on this booking: {formatBps(booking.commission_rate_bps)}
          </p>
        </Panel>

        <Panel title="Money">
          {booking.payments.length === 0 && booking.payouts.length === 0 ? (
            <p className="text-sm text-muted">No payment yet.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {booking.payments.map((payment) => (
                <li key={payment.id} className="flex flex-col gap-0.5">
                  <span className="flex justify-between gap-3">
                    <span className="font-medium">Payment · {payment.status.replace("_", " ")}</span>
                    <span className="tabular-nums">{formatNaira(payment.amount_minor)}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {payment.provider} · {payment.reference}
                    {payment.channel && ` · ${payment.channel}`}
                    {payment.paid_at && ` · ${formatDateTime(payment.paid_at)}`}
                    {payment.refunded_minor > 0 && ` · ${formatNaira(payment.refunded_minor)} refunded`}
                    {payment.refund_status === "pending" && " · refund on its way"}
                    {payment.refund_status === "failed" && " · refund failed"}
                  </span>
                  <span className="text-xs text-muted">
                    Platform fee {formatNaira(payment.platform_fee_minor)} · Business gets{" "}
                    {formatNaira(payment.provider_amount_minor)}
                  </span>
                </li>
              ))}
              {booking.payouts.map((payout) => (
                <li key={payout.id} className="flex flex-col gap-0.5">
                  <span className="flex justify-between gap-3">
                    <span className="font-medium">
                      Payout · {payoutLabels[payout.status] ?? payout.status}
                    </span>
                    <span className="tabular-nums">{formatNaira(payout.amount_minor)}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {formatNaira(payout.gross_minor)} less {formatNaira(payout.commission_minor)} commission
                    {payout.failure_reason && ` · ${payout.failure_reason}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
