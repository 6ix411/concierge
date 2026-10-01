import "server-only";

import { AppError, logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  evidenceExtension,
  evidenceProblem,
  sniffEvidenceType,
  type DisputeRole,
  type EvidenceType,
} from "./rules";

const BUCKET = "dispute-evidence";
const SIGNED_URL_SECONDS = 60 * 60;

export type CheckedFile = { name: string; bytes: Uint8Array; type: EvidenceType };

/**
 * Reads and checks the files in a form before anything is saved. An empty file picker sends one
 * empty file, which is ignored. Throws a VALIDATION_FAILED error with a message for the person.
 */
export async function readEvidence(formData: FormData, field = "files"): Promise<CheckedFile[]> {
  const files = formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  const problem = evidenceProblem(files);
  if (problem) throw new AppError("VALIDATION_FAILED", problem);
  const checked: CheckedFile[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffEvidenceType(bytes);
    if (!type)
      throw new AppError("VALIDATION_FAILED", `${file.name} isn't a photo, video or PDF we can accept.`);
    checked.push({ name: file.name.slice(0, 200) || "file", bytes, type });
  }
  return checked;
}

/** Stores checked files as evidence on a dispute. The database checks the uploader belongs to it. */
export async function saveEvidence(
  disputeId: string,
  uploader: { id: string; role: DisputeRole },
  files: CheckedFile[],
  messageId: string | null = null,
): Promise<void> {
  const db = createAdminClient();
  for (const file of files) {
    const path = `${disputeId}/${crypto.randomUUID()}.${evidenceExtension(file.type)}`;
    const upload = await db.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.type });
    if (upload.error) throw new AppError("INTERNAL", "Could not upload a file.", { cause: upload.error });
    const { error } = await db.from("dispute_evidence").insert({
      dispute_id: disputeId,
      message_id: messageId,
      uploaded_by: uploader.id,
      uploader_role: uploader.role,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.bytes.byteLength,
    });
    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      throw new AppError("INTERNAL", "Could not save a file.", { cause: error });
    }
  }
}

/** Short-lived links for evidence rows the viewer was already allowed to read. */
export async function signEvidence<T extends { storage_path: string }>(
  rows: T[],
): Promise<(T & { url: string | null })[]> {
  if (rows.length === 0) return [];
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      SIGNED_URL_SECONDS,
    );
  if (error) logger.error("Could not sign dispute evidence", { error });
  const signed = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));
  return rows.map((row) => ({ ...row, url: signed.get(row.storage_path) ?? null }));
}
