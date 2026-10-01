import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import {
  disputeOutcomeLabels,
  disputeStatusInfo,
  isDisputeOpen,
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

/** What the customer or business sees about a dispute on the booking page, with a link to it. */
export function DisputeStatus({
  dispute,
  viewer,
  href,
}: {
  dispute: BookingDispute;
  viewer: "customer" | "business";
  href: string;
}) {
  const open = isDisputeOpen(dispute.status);
  return (
    <section className="flex gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
      <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Dispute · {disputeStatusInfo[dispute.status].label.toLowerCase()}</h2>
        <p className="text-muted">“{dispute.reason}”</p>
        {open ? (
          <p>
            The Concierge team is looking into it.{" "}
            {viewer === "business" ? "Your payout is on hold until it’s settled." : "We’ll be in touch."}
          </p>
        ) : (
          <>
            <p className="font-medium">{disputeOutcomeLabels[dispute.outcome ?? ""] ?? "Closed"}</p>
            {dispute.resolution && <p>{dispute.resolution}</p>}
            {viewer === "customer" && dispute.refund_due_minor > 0 && (
              <p>{formatNaira(dispute.refund_due_minor)} will be refunded to you.</p>
            )}
          </>
        )}
        <Link href={href} className="mt-1 self-start font-medium underline underline-offset-2">
          {open ? "Open the dispute: messages and evidence" : "See the dispute"}
        </Link>
      </div>
    </section>
  );
}
