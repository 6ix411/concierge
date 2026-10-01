/** Review photos: what customers can add to a review. Checked in the browser and again on the server. */
export const MAX_REVIEW_PHOTOS = 4;
export const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;
export const REVIEW_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReviewPhotoType = (typeof REVIEW_PHOTO_TYPES)[number];

const extensions: Record<ReviewPhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function reviewPhotoExtension(type: ReviewPhotoType): string {
  return extensions[type];
}

/**
 * The real image type from the file's first bytes, so a renamed file can't pass as a photo.
 * Returns null for anything that isn't a JPEG, PNG or WebP.
 */
export function sniffImageType(bytes: Uint8Array): ReviewPhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)
  )
    return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Checks a set of photos before any upload. Returns a message for the customer, or null if fine. */
export function reviewPhotosProblem(files: { size: number; type: string }[]): string | null {
  if (files.length > MAX_REVIEW_PHOTOS) return `Add up to ${MAX_REVIEW_PHOTOS} photos.`;
  if (files.some((file) => !(REVIEW_PHOTO_TYPES as readonly string[]).includes(file.type)))
    return "Photos must be JPG, PNG or WebP.";
  if (files.some((file) => file.size > MAX_REVIEW_PHOTO_BYTES)) return "Each photo must be 5 MB or smaller.";
  return null;
}

/** What the Concierge team removes. Shown to customers when they write and to admins when they moderate. */
export const reviewGuidelines = [
  "Be about a real booking: what happened, how it went.",
  "No insults, hate speech, threats or personal details such as phone numbers.",
  "No adverts, links, or reviews written for or against a business in exchange for anything.",
  "Photos must be your own and show the job. Nothing explicit or unrelated.",
] as const;
