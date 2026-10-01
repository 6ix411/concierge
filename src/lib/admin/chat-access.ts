import "server-only";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import type { SessionUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Chats are private. An admin may open one only when there's a reason on record: a dispute on its
 * booking or a report filed from it. Returns that reason, or null.
 */
export async function adminChatAccessReason(
  conversationId: string,
): Promise<{ kind: "dispute" | "report"; id: string } | null> {
  const db = createAdminClient();
  const { data: conversation } = await db
    .from("conversations")
    .select("booking_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;
  const [{ data: dispute }, { data: report }] = await Promise.all([
    db
      .from("disputes")
      .select("id")
      .eq("booking_id", conversation.booking_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("chat_reports")
      .select("id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (dispute) return { kind: "dispute", id: dispute.id };
  if (report) return { kind: "report", id: report.id };
  return null;
}

/** Writes an admin's visit to a private chat in the audit log, at most once an hour per admin and chat. */
export async function logAdminChatView(
  admin: SessionUser,
  conversationId: string,
  access: { kind: "dispute" | "report"; id: string },
): Promise<void> {
  const { count } = await createAdminClient()
    .from("admin_actions")
    .select("id", { count: "exact", head: true })
    .eq("admin_id", admin.id)
    .eq("action", "conversation.view")
    .eq("target_id", conversationId)
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (count) return;
  await recordAdminAction(admin, {
    action: "conversation.view",
    targetType: "conversations",
    targetId: conversationId,
    metadata: { because: access.kind, id: access.id },
  });
}
