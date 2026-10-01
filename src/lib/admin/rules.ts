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
  refund: { from: ["cancelled"], to: "refunded", label: "Record refund" },
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

export type DisputeStatus = "open" | "under_review" | "resolved" | "rejected";
export type DisputeOutcome = "business" | "customer" | "dismissed";

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
      "The booking is cancelled and the payout is withheld. Record the refund once the money is back with the customer.",
    disputeStatus: "resolved",
  },
  dismissed: {
    label: "Dismiss",
    description: "Nothing changes. The booking goes back to where it was.",
    disputeStatus: "rejected",
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
  resolved: { label: "Resolved", tone: "verified" },
  rejected: { label: "Dismissed", tone: "neutral" },
};

export function isDisputeOpen(status: DisputeStatus): boolean {
  return status === "open" || status === "under_review";
}

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
  "booking.refund": "Recorded a refund",
  "dispute.start_review": "Started reviewing a dispute",
  "dispute.business": "Resolved a dispute for the business",
  "dispute.customer": "Resolved a dispute for the customer",
  "dispute.dismissed": "Dismissed a dispute",
  "review.hide": "Hid a review",
  "review.publish": "Published a review",
  "user.suspend": "Suspended a user",
  "user.reactivate": "Reactivated a user",
  "category.create": "Created a category",
  "category.update": "Edited a category",
  "category.delete": "Deleted a category",
  "settings.commission": "Changed the platform commission",
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
];
