import Link from "next/link";

import { Badge } from "@/components/ui";
import {
  disputeOutcomeLabels,
  disputeReasons,
  disputeStatusInfo,
  isDisputeOpen,
  type DisputeReason,
  type DisputeStatus,
} from "@/lib/admin/rules";
import { postDisputeMessageAction } from "@/lib/disputes/actions";
import type { DisputeCase } from "@/lib/disputes/queries";
import { formatDate, formatDateTime, formatNaira } from "@/lib/format";

import { DisputeComposer } from "./dispute-composer";
import { DisputeThread, EvidenceList } from "./dispute-thread";
import { WithdrawDispute } from "./withdraw-dispute";

const statusHelp: Record<DisputeStatus, string> = {
  open: "The Concierge team has your dispute and will pick it up soon. Add anything that helps.",
  under_review: "The Concierge team is looking into it and may ask both sides questions here.",
  escalated: "It has gone to a senior member of the Concierge team. It may take a little longer.",
  resolved: "The Concierge team made a decision.",
  closed: "This dispute is closed.",
};

/** The dispute page for the customer or the business: what was reported, the evidence and the thread. */
export function DisputeCaseView({
  data,
  viewer,
  viewerId,
  bookingHref,
}: {
  data: DisputeCase;
  viewer: "customer" | "business";
  viewerId: string;
  bookingHref: string;
}) {
  const { dispute, booking } = data;
  const status = dispute.status as DisputeStatus;
  const active = isDisputeOpen(status);
  const service =
    booking.booking_items.find((i) => i.kind !== "addon")?.name ?? booking.booking_items[0]?.name;
  const openedBy = dispute.opened_by === booking.customer_id ? "the customer" : "the business";

  return (
    <div className="flex flex-col gap-6">
      <Link href={bookingHref} className="text-sm text-muted hover:underline">
        Booking {booking.reference}
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Dispute: {dispute.reason}</h1>
          <Badge tone={disputeStatusInfo[status].tone}>{disputeStatusInfo[status].label}</Badge>
        </div>
        <p className="text-muted">{statusHelp[status]}</p>
      </div>

      <section
        aria-label="Dispute details"
        className="grid gap-4 rounded-2xl border border-border bg-surface p-4 text-sm sm:grid-cols-2"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted">Booking</dt>
          <dd className="font-medium">#{booking.reference}</dd>
          <dt className="text-muted">Customer</dt>
          <dd>{data.customerName}</dd>
          <dt className="text-muted">Business</dt>
          <dd>{booking.businesses?.name}</dd>
          {service && (
            <>
              <dt className="text-muted">Service</dt>
              <dd>{service}</dd>
            </>
          )}
          {booking.scheduled_start && (
            <>
              <dt className="text-muted">Date</dt>
              <dd>{formatDate(booking.scheduled_start)}</dd>
            </>
          )}
        </dl>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted">Reason</dt>
          <dd>{disputeReasons[dispute.reason_code as DisputeReason] ?? "Something else"}</dd>
          <dt className="text-muted">Opened</dt>
          <dd>
            {formatDateTime(dispute.created_at)} by {openedBy}
          </dd>
          <dt className="text-muted">Booking total</dt>
          <dd className="tabular-nums">{formatNaira(booking.total_minor)}</dd>
        </dl>
        {dispute.description && (
          <div className="sm:col-span-2">
            <p className="text-muted">What happened</p>
            <p className="mt-1 whitespace-pre-line">{dispute.description}</p>
          </div>
        )}
      </section>

      {!active && (
        <section className="flex flex-col gap-1 rounded-2xl border border-border bg-surface-muted p-4 text-sm">
          <h2 className="font-semibold">{disputeOutcomeLabels[dispute.outcome ?? ""] ?? "Closed"}</h2>
          {dispute.resolution && <p className="whitespace-pre-line">{dispute.resolution}</p>}
          {viewer === "customer" && dispute.refund_due_minor > 0 && (
            <p>{formatNaira(dispute.refund_due_minor)} will be refunded to you.</p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Evidence</h2>
        <EvidenceList evidence={data.evidence} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Messages and history</h2>
        <p className="text-sm text-muted">
          Both sides and the Concierge team see everything here. Nothing can be edited or deleted.
        </p>
        <DisputeThread thread={data} viewer={viewer} />
      </section>

      {active && (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <DisputeComposer disputeId={dispute.id} action={postDisputeMessageAction} />
          {dispute.opened_by === viewerId && <WithdrawDispute disputeId={dispute.id} />}
        </section>
      )}
    </div>
  );
}
