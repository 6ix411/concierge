"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import type { FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { adminChatAccessReason } from "./chat-access";

const optionalNote = z
  .string()
  .trim()
  .max(1000, "Keep it under 1000 characters.")
  .optional()
  .transform((value) => value || undefined);

/** Hides a message from both participants (or shows it again). Admins still see it. */
export async function moderateMessageAction(
  decision: "hide" | "restore",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const messageId = z.guid().parse(formData.get("messageId"));
    const db = createAdminClient();
    const { data: message } = await db
      .from("messages")
      .select("id, conversation_id")
      .eq("id", messageId)
      .maybeSingle();
    if (!message) throw new AppError("NOT_FOUND", "Message not found.");
    if (!(await adminChatAccessReason(message.conversation_id)))
      throw new AppError("FORBIDDEN", "This chat has no dispute or report.");
    const { error } = await db
      .from("messages")
      .update({ hidden_at: decision === "hide" ? new Date().toISOString() : null })
      .eq("id", messageId);
    if (error) throw new AppError("INTERNAL", "Could not update the message.", { cause: error });
    await recordAdminAction(admin, {
      action: `message.${decision}`,
      targetType: "messages",
      targetId: messageId,
      reason: optionalNote.parse(formData.get("reason") ?? undefined),
    });
  } catch (error) {
    return toFormError(error, "We couldn't update the message. Please try again.");
  }
  refresh();
  return { status: "success", message: decision === "hide" ? "Message hidden." : "Message shown again." };
}

/** Restricts a chat (read-only for both sides) or lifts the restriction. */
export async function restrictConversationAction(
  decision: "lock" | "unlock",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const conversationId = z.guid().parse(formData.get("conversationId"));
    const reason = optionalNote.parse(formData.get("reason") ?? undefined);
    if (decision === "lock" && !reason)
      return {
        status: "error",
        fieldErrors: { reason: "Give a reason. Both sides are told the chat is restricted." },
      };
    if (!(await adminChatAccessReason(conversationId)))
      throw new AppError("FORBIDDEN", "This chat has no dispute or report.");
    const db = createAdminClient();
    const { data: conversation } = await db
      .from("conversations")
      .update({ status: decision === "lock" ? "locked" : "open" })
      .eq("id", conversationId)
      .in("status", decision === "lock" ? ["open", "closed"] : ["locked"])
      .select("id, customer_id, bookings(reference, status), businesses(owner_id)")
      .maybeSingle();
    if (!conversation) throw new AppError("CONFLICT", "This chat changed. Refresh to see the latest.");
    // A chat for a finished booking goes back to closed, not open.
    if (
      decision === "unlock" &&
      conversation.bookings &&
      !["confirmed", "in_progress", "completed", "reviewed", "disputed"].includes(
        conversation.bookings.status,
      )
    )
      await db.from("conversations").update({ status: "closed" }).eq("id", conversationId);
    await recordAdminAction(admin, {
      action: `conversation.${decision}`,
      targetType: "conversations",
      targetId: conversationId,
      reason,
    });
    const people = [conversation.customer_id, conversation.businesses?.owner_id].filter((id): id is string =>
      Boolean(id),
    );
    await notify(
      ...people.map((userId) => ({
        userId,
        type: `conversation.${decision}`,
        title: decision === "lock" ? "Chat restricted" : "Chat reopened",
        body:
          decision === "lock"
            ? `The Concierge team restricted the chat for ${conversation.bookings?.reference}. Reason: ${reason}`
            : `You can message each other about ${conversation.bookings?.reference} again.`,
        data: { conversationId },
      })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't update the chat. Please try again.");
  }
  refresh();
  return { status: "success", message: decision === "lock" ? "Chat restricted." : "Chat reopened." };
}

/** Closes a report: action taken, or dismissed. The reporter is told it was reviewed. */
export async function resolveReportAction(
  outcome: "actioned" | "dismissed",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const reportId = z.guid().parse(formData.get("reportId"));
    const resolution = optionalNote.parse(formData.get("reason") ?? undefined);
    const db = createAdminClient();
    const { data: report } = await db
      .from("chat_reports")
      .update({
        status: outcome,
        resolution: resolution ?? null,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .eq("status", "open")
      .select("id, reporter_id, message_id")
      .maybeSingle();
    if (!report) throw new AppError("CONFLICT", "This report was already reviewed.");
    if (outcome === "dismissed" && report.message_id) {
      // Unflag the message unless another open report still points at it.
      const { count } = await db
        .from("chat_reports")
        .select("id", { count: "exact", head: true })
        .eq("message_id", report.message_id)
        .eq("status", "open");
      if (!count) await db.from("messages").update({ is_flagged: false }).eq("id", report.message_id);
    }
    await recordAdminAction(admin, {
      action: `chat_report.${outcome}`,
      targetType: "chat_reports",
      targetId: reportId,
      reason: resolution,
    });
    await notify({
      userId: report.reporter_id,
      type: "chat.report_reviewed",
      title: "Your report was reviewed",
      body: "Thanks for letting us know. The Concierge team has reviewed your report.",
      data: { reportId },
    });
  } catch (error) {
    return toFormError(error, "We couldn't update the report. Please try again.");
  }
  refresh();
  return {
    status: "success",
    message: outcome === "actioned" ? "Report closed: action taken." : "Report dismissed.",
  };
}
