import { ShieldAlert } from "lucide-react";

import {
  disputeOutcomes,
  disputeStatusInfo,
  isDisputeOpen,
  type DisputeOutcome,
  type DisputeStatus,
} from "@/lib/admin/rules";
import { formatNaira } from "@/lib/format";

export type BookingDispute = {
  id: string;
  status: DisputeStatus;
  reason: string;
  outcome: string | null;
  resolution: string | null;
  refund_due_minor: number;
};

/** What the customer or business sees about a reported problem. */
export function DisputeStatus({
  dispute,
  viewer,
}: {
  dispute: BookingDispute;
  viewer: "customer" | "business";
}) {
  const open = isDisputeOpen(dispute.status);
  const outcome = dispute.outcome as DisputeOutcome | null;
  return (
    <section className="flex gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
      <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">
          Problem reported · {disputeStatusInfo[dispute.status].label.toLowerCase()}
        </h2>
        <p className="text-muted">“{dispute.reason}”</p>
        {open ? (
          <p>
            The Concierge team is looking into it.{" "}
            {viewer === "business" ? "Your payout is on hold until it’s settled." : "We’ll be in touch."}
          </p>
        ) : (
          <>
            {outcome && <p className="font-medium">{disputeOutcomes[outcome]?.label ?? "Closed"}</p>}
            {dispute.resolution && <p>{dispute.resolution}</p>}
            {viewer === "customer" && dispute.refund_due_minor > 0 && (
              <p>{formatNaira(dispute.refund_due_minor)} will be refunded to you.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
