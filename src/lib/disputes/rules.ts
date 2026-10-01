import { sniffImageType } from "@/lib/reviews/rules";

/** Evidence files: what either side (or the Concierge team) can add to a dispute. */
export const MAX_EVIDENCE_FILES = 5;
/** Per message, all files together: they go through one server action request. */
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const extensions: Record<EvidenceType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export function evidenceExtension(type: EvidenceType): string {
  return extensions[type];
}

/**
 * The real file type from its first bytes, so a renamed file can't pass as evidence.
 * Null for anything that isn't a photo, a video or a PDF.
 */
export function sniffEvidenceType(bytes: Uint8Array): EvidenceType | null {
  const image = sniffImageType(bytes);
  if (image) return image;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp")
    return ascii(8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  return null;
}

/** Checks files before upload. Returns a message for the person, or null if fine. */
export function evidenceProblem(files: { size: number; type: string }[]): string | null {
  if (files.length > MAX_EVIDENCE_FILES) return `Add up to ${MAX_EVIDENCE_FILES} files at a time.`;
  if (files.some((file) => !(EVIDENCE_TYPES as readonly string[]).includes(file.type)))
    return "Files must be photos (JPG, PNG, WebP), videos (MP4, MOV, WebM) or PDFs.";
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_EVIDENCE_BYTES)
    return "Files can be up to 20 MB in total. Send large videos one at a time.";
  return null;
}

export type DisputeRole = "customer" | "business" | "admin";

/** How each person in a dispute is named to the others. */
export const disputeRoleLabels: Record<DisputeRole | "system", string> = {
  customer: "Customer",
  business: "Business",
  admin: "Concierge team",
  system: "Concierge",
};
