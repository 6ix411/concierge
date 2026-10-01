import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { Panel } from "@/components/admin/dashboard-widgets";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { DisputeComposer } from "@/components/disputes/dispute-composer";
import { DisputeThread, EvidenceList } from "@/components/disputes/dispute-thread";
import { Badge } from "@/components/ui";
import {
  adminDisputeMessageAction,
  escalateDisputeAction,
  resolveDisputeAction,
  startDisputeReviewAction,
} from "@/lib/admin/dispute-actions";
import {
  disputeOutcomeLabels,
  disputeOutcomes,
  disputeReasons,
  disputeStatusInfo,
  isDisputeOpen,
  type DisputeOutcome,
  type DisputeReason,
} from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { bookingStatusLabels } from "@/lib/bookings/rules";
import { getAdminDisputeThread } from "@/lib/disputes/queries";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Dispute" };

const outcomeOrder: DisputeOutcome[] = ["business", "customer", "dismissed"];

export default async function AdminDisputePage({ params }: PageProps<"/admin/disputes/[id]">) {
  await requireAreaAccess("admin");
  const { id } = await params;
  const { data: dispute, error } = await createAdminClient()
    .from("disputes")
    .select(
      `id, reason, reason_code, description, status, outcome, resolution, resolved_at, refund_due_minor, previous_booking_status, escalated_at, escalation_reason, created_at,
       opener:users!disputes_opened_by_fkey(id, full_name, email, role),
       resolver:users!disputes_resolved_by_fkey(full_name),
       booking:bookings(id, reference, status, scheduled_start, total_minor, completed_at,
         business:businesses(id, name), customer:users!bookings_customer_id_fkey(id, full_name, email), conversations(id),
         payments(status, amount_minor, refunded_minor), payouts(status, amount_minor))`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the dispute.", { cause: error });
  if (!dispute?.booking) notFound();
  const { booking } = dispute;
  const open = isDisputeOpen(dispute.status);
  const paid = booking.payments
    .filter((p) => p.status === "success" || p.status === "partially_refunded")
    .reduce((sum, p) => sum + p.amount_minor - p.refunded_minor, 0);
  const payout = booking.payouts[0];
  const thread = await getAdminDisputeThread(dispute.id);

  return (
    <div className="flex flex-col gap-6">
      <Link href={adminHref("/disputes")} className="text-sm text-muted hover:underline">
        Disputes
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{dispute.reason}</h1>
          <Badge tone={disputeStatusInfo[dispute.status].tone}>
            {disputeStatusInfo[dispute.status].label}
          </Badge>
        </div>
        <p className="text-sm text-muted">
          Reported by {dispute.opener?.full_name ?? dispute.opener?.email} (
          {dispute.opener?.role === "business" ? "the business" : "the customer"}) on{" "}
          {formatDateTime(dispute.created_at)} ·{" "}
          {disputeReasons[dispute.reason_code as DisputeReason] ?? "Something else"}
        </p>
      </div>

      {dispute.status === "escalated" && dispute.escalation_reason && (
        <p className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
          <span className="font-medium">Escalated</span>
          {dispute.escalated_at && ` on ${formatDateTime(dispute.escalated_at)}`}: {dispute.escalation_reason}
        </p>
      )}

      {dispute.description && (
        <Panel title="What happened">
          <p className="text-sm whitespace-pre-line">{dispute.description}</p>
        </Panel>
      )}

      <Panel title={`Evidence (${thread.evidence.length})`}>
        <EvidenceList evidence={thread.evidence} />
      </Panel>

      <Panel title="Messages and history">
        <p className="text-sm text-muted">
          Both sides see your messages. Internal notes are for admins only. Nothing here can be edited or
          deleted.
        </p>
        <DisputeThread thread={thread} viewer="admin" />
        {open && <DisputeComposer disputeId={dispute.id} action={adminDisputeMessageAction} admin />}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Booking">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Reference</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Link href={adminHref(`/bookings/${booking.id}`)} className="font-medium hover:underline">
                {booking.reference}
              </Link>
              <BookingStatusBadge status={booking.status} />
            </dd>
            {booking.conversations && (
              <>
                <dt className="text-muted">Chat</dt>
                <dd>
                  <Link
                    href={adminHref(`/conversations/${booking.conversations.id}`)}
                    className="font-medium hover:underline"
                  >
                    Read the chat
                  </Link>
                  <span className="block text-xs text-muted">Opening it is recorded in the audit log.</span>
                </dd>
              </>
            )}
            <dt className="text-muted">Business</dt>
            <dd>
              <Link href={adminHref(`/businesses/${booking.business?.id}`)} className="hover:underline">
                {booking.business?.name}
              </Link>
            </dd>
            <dt className="text-muted">Customer</dt>
            <dd>
              <Link href={adminHref(`/users/${booking.customer?.id}`)} className="hover:underline">
                {booking.customer?.full_name ?? booking.customer?.email}
              </Link>
            </dd>
            <dt className="text-muted">When</dt>
            <dd>{booking.scheduled_start ? formatDateTime(booking.scheduled_start) : "Not set"}</dd>
            {dispute.previous_booking_status && (
              <>
                <dt className="text-muted">Before dispute</dt>
                <dd>{bookingStatusLabels[dispute.previous_booking_status]}</dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel title="Money at stake">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Customer paid</dt>
            <dd className="tabular-nums">{formatNaira(paid)}</dd>
            <dt className="text-muted">Business payout</dt>
            <dd>
              {payout ? (
                <>
                  <span className="tabular-nums">{formatNaira(payout.amount_minor)}</span>{" "}
                  <span className="text-muted">
                    (
                    {payout.status === "on_hold"
                      ? "on hold"
                      : payout.status === "failed"
                        ? "withheld"
                        : payout.status}
                    )
                  </span>
                </>
              ) : (
                "None yet"
              )}
            </dd>
            {dispute.refund_due_minor > 0 && (
              <>
                <dt className="text-muted">Refund due</dt>
                <dd className="font-medium tabular-nums">{formatNaira(dispute.refund_due_minor)}</dd>
              </>
            )}
          </dl>
        </Panel>
      </div>

      {open ? (
        <Panel title="Decision">
          <p className="text-sm text-muted">
            Speak to both sides first. Your explanation is sent to the customer and the business.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            {dispute.status === "open" && (
              <AdminActionForm
                action={startDisputeReviewAction}
                fields={{ disputeId: dispute.id }}
                label="Start review"
              />
            )}
            {dispute.status !== "escalated" && (
              <AdminActionForm
                action={escalateDisputeAction}
                fields={{ disputeId: dispute.id }}
                label="Escalate"
                variant="outline"
                reason={{ label: "Why does it need escalating? (admins only)", required: true }}
              />
            )}
          </div>
          <ul className="flex flex-col gap-4">
            {outcomeOrder.map((outcome) => (
              <li key={outcome} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <p className="text-sm">{disputeOutcomes[outcome].description}</p>
                <AdminActionForm
                  action={resolveDisputeAction.bind(null, outcome)}
                  fields={{ disputeId: dispute.id }}
                  label={disputeOutcomes[outcome].label}
                  variant={outcome === "customer" ? "danger" : outcome === "business" ? "primary" : "outline"}
                  reason={{ label: "Explain the decision", required: true, name: "resolution" }}
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel title="Decision">
          <p className="text-sm font-medium">{disputeOutcomeLabels[dispute.outcome ?? ""] ?? "Closed"}</p>
          {dispute.resolution && <p className="text-sm whitespace-pre-line">{dispute.resolution}</p>}
          <p className="text-xs text-muted">
            {dispute.resolver?.full_name && `By ${dispute.resolver.full_name} · `}
            {dispute.resolved_at && formatDateTime(dispute.resolved_at)}
          </p>
        </Panel>
      )}
    </div>
  );
}
