import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { Panel } from "@/components/admin/dashboard-widgets";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { Badge } from "@/components/ui";
import { adminBookingAction } from "@/lib/admin/booking-actions";
import { adminBookingActionsFor, disputeStatusInfo, formatBps } from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
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
      `id, reference, status, scheduled_start, scheduled_end, address_line, city, state, customer_notes, quote_notes,
       subtotal_minor, platform_fee_minor, total_minor, commission_rate_bps, created_at, accepted_at, confirmed_at,
       completed_at, cancelled_at, cancellation_reason,
       business:businesses(id, name, owner_id),
       customer:users!bookings_customer_id_fkey(id, full_name, email),
       cancelled_by_user:users!bookings_cancelled_by_fkey(full_name, role),
       booking_items(id, name, unit_price_minor, quantity, total_minor),
       payments(id, provider, reference, status, amount_minor, refunded_minor, paid_at),
       payouts(id, status, gross_minor, commission_minor, amount_minor, failure_reason, paid_at),
       disputes(id, reason, status, created_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the booking.", { cause: error });
  if (!booking) notFound();

  const actions = adminBookingActionsFor(booking.status);
  const timeline = [
    { label: "Requested", at: booking.created_at },
    { label: "Accepted", at: booking.accepted_at },
    { label: "Paid and confirmed", at: booking.confirmed_at },
    { label: "Completed", at: booking.completed_at },
    {
      label: booking.cancelled_by_user
        ? `Cancelled by ${booking.cancelled_by_user.role === "admin" ? "the Concierge team" : (booking.cancelled_by_user.full_name ?? "a user")}`
        : "Cancelled",
      at: booking.cancelled_at,
    },
  ].filter((step): step is { label: string; at: string } => Boolean(step.at));

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
            <dd>
              {[booking.address_line, booking.city, booking.state].filter(Boolean).join(", ") || "Not set"}
            </dd>
            {booking.customer_notes && (
              <>
                <dt className="text-muted">Notes</dt>
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

        <Panel title="Timeline">
          <ol className="flex flex-col gap-2 text-sm">
            {timeline.map((step) => (
              <li key={step.label} className="flex justify-between gap-3">
                <span>{step.label}</span>
                <span className="text-muted">{formatDateTime(step.at)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Price">
          <ul className="flex flex-col gap-1 text-sm">
            {booking.booking_items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>
                  {item.name}
                  {item.quantity > 1 && ` × ${item.quantity}`}
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
                    {payment.paid_at && ` · ${formatDateTime(payment.paid_at)}`}
                    {payment.refunded_minor > 0 && ` · ${formatNaira(payment.refunded_minor)} refunded`}
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
