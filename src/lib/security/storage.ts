import "server-only";

import { logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import { allowedFileType, SNIFF_BYTES, type SniffedType } from "./files";

/** The first bytes and size of a stored file, read with the service role (callers check access first). */
export async function readStoredHead(
  bucket: string,
  path: string,
): Promise<{ head: Uint8Array; size: number } | null> {
  const db = createAdminClient();
  const folder = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").at(-1);
  const { data: listed } = await db.storage.from(bucket).list(folder, { search: name, limit: 5 });
  const object = listed?.find((entry) => entry.name === name);
  if (!object) return null;
  const { data: signed } = await db.storage.from(bucket).createSignedUrl(path, 60);
  if (!signed?.signedUrl) return null;
  const response = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` } });
  if (!response.ok) return null;
  const head = new Uint8Array(await response.arrayBuffer()).subarray(0, SNIFF_BYTES);
  const size = Number(object.metadata?.size ?? head.length);
  return { head, size };
}

/**
 * Checks a file someone uploaded straight to storage. If it isn't one of the allowed types (by its
 * contents, not its name), it is deleted and null is returned.
 */
export async function verifyStoredFile<T extends SniffedType>(
  bucket: string,
  path: string,
  allowed: readonly T[],
): Promise<{ type: T; size: number } | null> {
  const stored = await readStoredHead(bucket, path);
  const type = stored ? allowedFileType(stored.head, allowed) : null;
  if (stored && type) return { type, size: stored.size };
  if (stored) {
    const { error } = await createAdminClient().storage.from(bucket).remove([path]);
    if (error) logger.warn("Could not remove a rejected upload", { bucket, path, error });
  }
  return null;
}
