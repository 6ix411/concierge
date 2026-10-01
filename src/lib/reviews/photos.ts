import "server-only";

import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import { reviewPhotoExtension, type ReviewPhotoType } from "./rules";

const BUCKET = "review-photos";
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * Stores checked photos for a review the server has just saved. Photos that fail to upload are
 * skipped (the review itself stays); returns how many were saved.
 */
export async function saveReviewPhotos(
  reviewId: string,
  photos: { bytes: Uint8Array; type: ReviewPhotoType }[],
): Promise<number> {
  const db = createAdminClient();
  let saved = 0;
  for (const [index, photo] of photos.entries()) {
    const path = `${reviewId}/${crypto.randomUUID()}.${reviewPhotoExtension(photo.type)}`;
    const upload = await db.storage.from(BUCKET).upload(path, photo.bytes, { contentType: photo.type });
    if (upload.error) {
      logger.error("Review photo upload failed", { error: upload.error, reviewId });
      continue;
    }
    const { error } = await db
      .from("review_photos")
      .insert({ review_id: reviewId, storage_path: path, sort_order: index });
    if (error) {
      logger.error("Review photo record failed", { error, reviewId });
      await db.storage.from(BUCKET).remove([path]);
      continue;
    }
    saved += 1;
  }
  return saved;
}

/**
 * Short-lived links for review photos. Callers pass only paths of reviews the viewer may already
 * see (the bucket is private, so nothing else is reachable).
 */
export async function signReviewPhotos(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) logger.error("Could not sign review photos", { error });
  for (const entry of data ?? []) if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  return signed;
}

export type ReviewPhoto = { id: string; url: string };

/** Photos for reviews already loaded with the viewer's own permissions, as signed links per review. */
export async function photosForReviews(reviewIds: string[]): Promise<Map<string, ReviewPhoto[]>> {
  const byReview = new Map<string, ReviewPhoto[]>();
  if (reviewIds.length === 0) return byReview;
  const { data } = await createAdminClient()
    .from("review_photos")
    .select("id, review_id, storage_path")
    .in("review_id", reviewIds)
    .order("sort_order");
  const signed = await signReviewPhotos((data ?? []).map((p) => p.storage_path));
  for (const photo of data ?? []) {
    const url = signed.get(photo.storage_path);
    if (url) byReview.set(photo.review_id, [...(byReview.get(photo.review_id) ?? []), { id: photo.id, url }]);
  }
  return byReview;
}

/** Deletes one photo and its file (admin moderation). Returns the review it belonged to. */
export async function removeReviewPhoto(photoId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("review_photos")
    .delete()
    .eq("id", photoId)
    .select("review_id, storage_path")
    .maybeSingle();
  if (data) await db.storage.from(BUCKET).remove([data.storage_path]);
  return data?.review_id ?? null;
}
