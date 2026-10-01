import type { Database } from "@/types/database";

export type BusinessStatus = Database["public"]["Enums"]["business_status"];

type StatusInfo = {
  label: string;
  tone: "neutral" | "accent" | "verified" | "danger";
  /** What the owner should know or do next. */
  message: string;
};

/** How each status reads to the business owner. Only approved businesses are visible to customers. */
export const businessStatusInfo: Record<BusinessStatus, StatusInfo> = {
  draft: {
    label: "Not submitted",
    tone: "neutral",
    message: "Finish your registration and submit it for review. Customers can't see you yet.",
  },
  pending: {
    label: "Pending",
    tone: "accent",
    message: "Thanks for submitting. Our team will start reviewing your business shortly.",
  },
  under_review: {
    label: "Under review",
    tone: "accent",
    message: "Our team is reviewing your business. We'll let you know if we need anything else.",
  },
  approved: {
    label: "Approved",
    tone: "verified",
    message: "You're live. Customers and the concierge can find and book you.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    message: "Your business wasn't approved. Update your details and submit it again.",
  },
  suspended: {
    label: "Suspended",
    tone: "danger",
    message: "Your business is hidden from customers. Contact support to resolve this.",
  },
};

/** Owners can submit a new registration, or resubmit after fixing a rejected one. */
export function canSubmitForReview(status: BusinessStatus): boolean {
  return status === "draft" || status === "rejected";
}

/** Only approved businesses are shown to customers or recommended by the concierge. */
export function isPubliclyVisible(status: BusinessStatus): boolean {
  return status === "approved";
}
