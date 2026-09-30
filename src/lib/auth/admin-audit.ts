import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import type { SessionUser } from "./session";

/** Records an admin decision in the append-only audit log. Call after the change succeeds. */
export async function recordAdminAction(
  admin: SessionUser,
  entry: { action: string; targetType: string; targetId?: string; reason?: string; metadata?: Json },
): Promise<void> {
  if (admin.role !== "admin") throw new AppError("FORBIDDEN", "Only admins can perform this action.");
  const { error } = await createAdminClient()
    .from("admin_actions")
    .insert({
      admin_id: admin.id,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? {},
    });
  if (error) throw new AppError("INTERNAL", "Could not record the admin action.", { cause: error });
}
