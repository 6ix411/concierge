import type { BusinessStatus } from "@/lib/business/status";

export type AdminBusinessDecision = "start_review" | "approve" | "reject" | "suspend" | "reinstate";

/** Which statuses each admin decision applies to, and the status it leads to. Mirrors the database rules. */
export const adminBusinessDecisions: Record<
  AdminBusinessDecision,
  { from: BusinessStatus[]; to: BusinessStatus; label: string }
> = {
  start_review: { from: ["pending"], to: "under_review", label: "Start review" },
  approve: { from: ["pending", "under_review"], to: "approved", label: "Approve" },
  reject: { from: ["pending", "under_review"], to: "rejected", label: "Reject" },
  suspend: { from: ["approved"], to: "suspended", label: "Suspend" },
  reinstate: { from: ["suspended"], to: "approved", label: "Reactivate" },
};

export function decisionsFor(status: BusinessStatus): AdminBusinessDecision[] {
  return (Object.keys(adminBusinessDecisions) as AdminBusinessDecision[]).filter((decision) =>
    adminBusinessDecisions[decision].from.includes(status),
  );
}
