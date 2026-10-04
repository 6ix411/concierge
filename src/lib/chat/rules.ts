import type { SniffedType } from "@/lib/security/files";

/** Why someone reports a message or person in a booking chat. */
export const reportReasons = {
  harassment: { label: "Harassment or abuse" },
  scam: { label: "Scam or fraud" },
  off_platform_payment: { label: "Asking to pay outside Concierge" },
  spam: { label: "Spam" },
  inappropriate: { label: "Inappropriate content" },
  other: { label: "Something else" },
} as const;

export type ReportReason = keyof typeof reportReasons;

// Nigerian phone numbers (080…, +234…, 234…) and email addresses, loosely. In chat this only
// reminds people to keep talking on Concierge (the database also marks such messages for the team,
// see `shares_contact`); booking notes and quotes, sent before anyone has paid, refuse them.
const phonePattern = /(?:\+?234|\b0)[\s-]?[789][01][\s-]?\d{1}[\s-]?\d{3}[\s-]?\d{4}\b/;
const emailPattern = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

export function sharesContactDetails(text: string): boolean {
  return phonePattern.test(text) || emailPattern.test(text);
}

/** Read receipts: a message I sent is seen once the other person has read the chat past it. */
export function isSeen(messageCreatedAt: string, otherLastReadAt: string | null | undefined): boolean {
  return (
    Boolean(otherLastReadAt) && new Date(otherLastReadAt!).getTime() >= new Date(messageCreatedAt).getTime()
  );
}

const KB = 1024;
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < KB * KB) return `${Math.max(1, Math.round(bytes / KB))} KB`;
  return `${(bytes / KB / KB).toFixed(1)} MB`;
}

/** What can be sent in chat. The server checks each file's contents, not just its name or type. */
export const CHAT_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const satisfies SniffedType[];
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
