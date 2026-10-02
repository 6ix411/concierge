import type { BookingStatus } from "@/lib/bookings/rules";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export type AdminBookingAction = "complete" | "cancel" | "refund";

/** What an admin can do to a booking, by status. Mirrors the database's allowed transitions. */
export const adminBookingActions: Record<
  AdminBookingAction,
  { from: BookingStatus[]; to: BookingStatus; label: string }
> = {
  complete: { from: ["confirmed", "in_progress"], to: "completed", label: "Mark as completed" },
  cancel: {
    from: [
      "requested",
      "pending_provider",
      "quoted",
      "accepted",
      "payment_pending",
      "confirmed",
      "in_progress",
    ],
    to: "cancelled",
    label: "Cancel booking",
  },
  refund: { from: ["cancelled"], to: "refunded", label: "Refund customer" },
};

/** Refunds only apply to cancelled bookings with money still owed back to the customer. */
export function adminBookingActionsFor(status: BookingStatus, refundDueMinor = 0): AdminBookingAction[] {
  return (Object.keys(adminBookingActions) as AdminBookingAction[]).filter(
    (action) =>
      adminBookingActions[action].from.includes(status) && (action !== "refund" || refundDueMinor > 0),
  );
}

/** What was paid and not yet refunded. */
export function amountPaid(
  payments: { status: string; amount_minor: number; refunded_minor: number }[],
): number {
  return payments
    .filter((p) => p.status === "success" || p.status === "partially_refunded")
    .reduce((sum, p) => sum + p.amount_minor - p.refunded_minor, 0);
}

export const activeBookingStatuses: BookingStatus[] = [
  "requested",
  "pending_provider",
  "quoted",
  "accepted",
  "payment_pending",
  "confirmed",
  "in_progress",
  "disputed",
];

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

/** Customers and businesses can report a problem up to this many days after a job is completed. */
export const DISPUTE_WINDOW_DAYS = 14;
const disputableStatuses: BookingStatus[] = ["confirmed", "in_progress", "completed", "reviewed"];

export function canOpenDispute(
  booking: { status: BookingStatus; completed_at: string | null },
  now: Date = new Date(),
): boolean {
  if (!disputableStatuses.includes(booking.status)) return false;
  if (booking.status !== "completed" && booking.status !== "reviewed") return true;
  if (!booking.completed_at) return false;
  const ageMs = now.getTime() - new Date(booking.completed_at).getTime();
  return ageMs <= DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export type DisputeStatus = "open" | "under_review" | "escalated" | "resolved" | "closed";
/** The decisions an admin can make. A dispute can also end as "withdrawn" by whoever opened it. */
export type DisputeOutcome = "business" | "customer" | "dismissed";

/** The kind of problem, chosen when the dispute is opened. */
export const disputeReasons = {
  not_delivered: "The service wasn’t delivered",
  poor_quality: "Poor quality or not as agreed",
  no_show: "No-show or didn’t turn up on time",
  late: "Very late or unfinished",
  damage: "Damage or loss",
  overcharged: "Charged more than agreed",
  behaviour: "Rude or unsafe behaviour",
  other: "Something else",
} as const;
export type DisputeReason = keyof typeof disputeReasons;

export const disputeOutcomes: Record<
  DisputeOutcome,
  { label: string; description: string; disputeStatus: DisputeStatus }
> = {
  business: {
    label: "Side with the business",
    description: "The job stands. The booking is marked completed and the business is paid.",
    disputeStatus: "resolved",
  },
  customer: {
    label: "Refund the customer",
    description:
      "The booking is cancelled and the payout is withheld. Then refund the customer from the booking page.",
    disputeStatus: "resolved",
  },
  dismissed: {
    label: "Dismiss",
    description: "Nothing changes. The booking goes back to where it was.",
    disputeStatus: "closed",
  },
};

/** Where the booking goes when a dispute closes. */
export function bookingStatusAfterDispute(
  outcome: DisputeOutcome,
  previous: BookingStatus | null,
): BookingStatus {
  if (outcome === "business") return previous === "reviewed" ? "reviewed" : "completed";
  if (outcome === "customer") return "cancelled";
  return previous && previous !== "disputed" ? previous : "completed";
}

export const disputeStatusInfo: Record<
  DisputeStatus,
  { label: string; tone: "neutral" | "accent" | "verified" | "danger" }
> = {
  open: { label: "Open", tone: "danger" },
  under_review: { label: "Under review", tone: "accent" },
  escalated: { label: "Escalated", tone: "danger" },
  resolved: { label: "Resolved", tone: "verified" },
  closed: { label: "Closed", tone: "neutral" },
};

/** Still being handled: messages and evidence can be added, and the team can decide. */
export const activeDisputeStatuses: DisputeStatus[] = ["open", "under_review", "escalated"];

export function isDisputeOpen(status: DisputeStatus): boolean {
  return activeDisputeStatuses.includes(status);
}

/** How a finished dispute ended, in words for the customer and business. */
export const disputeOutcomeLabels: Record<string, string> = {
  business: "Decided for the business",
  customer: "Decided for the customer",
  dismissed: "Dismissed",
  withdrawn: "Withdrawn",
};

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

/** The platform_settings key for the default commission. */
export const COMMISSION_SETTING = "default_commission_rate_bps";

/** Highest commission the dashboard accepts, in basis points (50%). */
export const MAX_COMMISSION_BPS = 5000;

/** "12.5" → 1250. Returns null for anything that isn't a percentage with up to two decimals. */
export function percentToBps(input: string): number | null {
  const value = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const bps = Math.round(Number(value) * 100);
  return bps >= 0 && bps <= MAX_COMMISSION_BPS ? bps : null;
}

/** 1250 → "12.5%". */
export function formatBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type UserStatus = "active" | "suspended" | "deactivated";
export type UserStatusDecision = "suspend" | "reactivate";

/** Why an admin can't make this change, or null when they can. */
export function userStatusBlocker(
  actorId: string,
  target: { id: string; role: UserRole; status: UserStatus },
  decision: UserStatusDecision,
): string | null {
  if (target.id === actorId) return "You can't change your own account status.";
  if (decision === "suspend" && target.status !== "active") return "This account isn't active.";
  if (decision === "reactivate" && target.status === "active") return "This account is already active.";
  return null;
}

export const userStatusInfo: Record<UserStatus, { label: string; tone: "neutral" | "verified" | "danger" }> =
  {
    active: { label: "Active", tone: "verified" },
    suspended: { label: "Suspended", tone: "danger" },
    deactivated: { label: "Deactivated", tone: "neutral" },
  };

export const roleLabels: Record<UserRole, string> = {
  customer: "Customer",
  business: "Business owner",
  admin: "Admin",
};

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const auditLabels: Record<string, string> = {
  "business.start_review": "Started reviewing a business",
  "business.approve": "Approved a business",
  "business.reject": "Rejected a business",
  "business.suspend": "Suspended a business",
  "business.reinstate": "Reactivated a business",
  "business.request_verification": "Requested verification information",
  "business.commission": "Changed a business's commission",
  "verification.approve": "Accepted a verification document",
  "verification.reject": "Rejected a verification document",
  "booking.complete": "Marked a booking completed",
  "booking.cancel": "Cancelled a booking",
  "booking.refund": "Refunded a customer",
  "payout.send": "Sent a payout",
  "conversation.view": "Opened a private chat",
  "conversation.lock": "Restricted a chat",
  "conversation.unlock": "Reopened a chat",
  "message.hide": "Hid a chat message",
  "message.restore": "Showed a hidden chat message",
  "chat_report.actioned": "Acted on a chat report",
  "chat_report.dismissed": "Dismissed a chat report",
  "payout.send_all": "Sent all ready payouts",
  "dispute.start_review": "Started reviewing a dispute",
  "dispute.business": "Resolved a dispute for the business",
  "dispute.customer": "Resolved a dispute for the customer",
  "dispute.dismissed": "Dismissed a dispute",
  "dispute.escalate": "Escalated a dispute",
  "dispute.message": "Messaged a dispute",
  "review.hide": "Hid a review",
  "review.publish": "Published a review",
  "review.report_dismissed": "Kept a reported review",
  "review.photo_removed": "Removed a review photo",
  "user.suspend": "Suspended a user",
  "user.reactivate": "Reactivated a user",
  "category.create": "Created a category",
  "category.update": "Edited a category",
  "category.delete": "Deleted a category",
  "settings.commission": "Changed the platform commission",
  "settings.plan": "Changed a subscription plan",
  "settings.featured_package": "Changed a featured placement price",
  "settings.featured_slots": "Changed the number of featured slots",
  "settings.booking_fee": "Changed the customer booking fee",
};

export function auditLabel(action: string): string {
  return auditLabels[action] ?? action.replace(/[._]/g, " ");
}

/** Audit log filter groups, by the target table. */
export const auditTargets: { key: string; label: string }[] = [
  { key: "businesses", label: "Providers" },
  { key: "business_verifications", label: "Documents" },
  { key: "bookings", label: "Bookings" },
  { key: "disputes", label: "Disputes" },
  { key: "reviews", label: "Reviews" },
  { key: "users", label: "Users" },
  { key: "service_categories", label: "Categories" },
  { key: "platform_settings", label: "Settings" },
  { key: "subscription_plans", label: "Plans" },
  { key: "featured_packages", label: "Featured placement" },
];
