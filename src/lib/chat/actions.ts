"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { reportReasons } from "./rules";

const reportSchema = z.object({
  conversationId: z.guid(),
  messageId: z.guid().optional(),
  reason: z.enum(
    Object.keys(reportReasons) as [keyof typeof reportReasons, ...(keyof typeof reportReasons)[]],
    {
      error: "Choose a reason.",
    },
  ),
  details: z
    .string()
    .trim()
    .max(1000, "Keep it under 1000 characters.")
    .optional()
    .transform((value) => value || undefined),
});

/**
 * The conversation as the signed-in user sees it (RLS: participants only), and who the other
 * person is. Everything below acts only on conversations the caller is part of.
 */
async function participantContext(conversationId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, customer_id, booking_id, businesses(owner_id, name), bookings(reference)")
    .eq("id", conversationId)
    .maybeSingle();
  const ownerId = conversation?.businesses?.owner_id;
  if (!conversation || !ownerId || (user.id !== conversation.customer_id && user.id !== ownerId))
    throw new AppError("NOT_FOUND", "Conversation not found.");
  const otherId = user.id === conversation.customer_id ? ownerId : conversation.customer_id;
  return { user, conversation, otherId };
}

/** Reports a message, or the other person when no message is given. The Concierge team reviews it. */
export async function reportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const parsed = reportSchema.safeParse({
      conversationId: formData.get("conversationId"),
      messageId: formData.get("messageId") || undefined,
      reason: formData.get("reason"),
      details: formData.get("details") ?? undefined,
    });
    if (!parsed.success)
      return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the report." };
    const { conversationId, messageId, reason, details } = parsed.data;
    const { user, otherId } = await participantContext(conversationId);
    const admin = createAdminClient();

    if (messageId) {
      // Only the other person's messages in this conversation can be reported.
      const { data: message } = await admin
        .from("messages")
        .select("id, sender_id")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (!message || message.sender_id !== otherId) throw new AppError("NOT_FOUND", "Message not found.");
    }

    const { data: report, error } = await admin
      .from("chat_reports")
      .insert({
        conversation_id: conversationId,
        message_id: messageId ?? null,
        reporter_id: user.id,
        reported_user_id: otherId,
        reason,
        details: details ?? null,
      })
      .select("id")
      .single();
    if (error?.code === "23505")
      return {
        status: "success",
        message: "You've already reported this. The Concierge team will look at it.",
      };
    if (error) throw new AppError("INTERNAL", "Could not send the report.", { cause: error });
    if (messageId) await admin.from("messages").update({ is_flagged: true }).eq("id", messageId);
    const { data: admins } = await admin
      .from("users")
      .select("id")
      .eq("role", "admin")
      .eq("status", "active");
    await notify(
      ...(admins ?? []).map((a) => ({
        userId: a.id,
        type: "chat.report",
        title: "New chat report",
        body: `${reportReasons[reason].label}. Review it in the admin dashboard.`,
        data: { reportId: report.id },
      })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't send your report. Please try again.");
  }
  return {
    status: "success",
    message: "Thanks. The Concierge team will review it. Nothing is shared with the other person.",
  };
}

/** Blocks the other person: neither side can send messages until it's lifted. */
export async function blockAction(conversationId: string, _prev: FormState): Promise<FormState> {
  try {
    const { user, otherId, conversation } = await participantContext(z.guid().parse(conversationId));
    const { error } = await createAdminClient()
      .from("user_blocks")
      .upsert({ blocker_id: user.id, blocked_id: otherId, conversation_id: conversation.id });
    if (error) throw new AppError("INTERNAL", "Could not block.", { cause: error });
  } catch (error) {
    return toFormError(error, "We couldn't block this person. Please try again.");
  }
  refresh();
  return { status: "success", message: "Blocked. Neither of you can send messages here now." };
}

/** Lifts a block the signed-in user made. */
export async function unblockAction(conversationId: string, _prev: FormState): Promise<FormState> {
  try {
    const { user, otherId } = await participantContext(z.guid().parse(conversationId));
    const { error } = await createAdminClient()
      .from("user_blocks")
      .delete()
      .eq("blocker_id", user.id)
      .eq("blocked_id", otherId);
    if (error) throw new AppError("INTERNAL", "Could not unblock.", { cause: error });
  } catch (error) {
    return toFormError(error, "We couldn't unblock. Please try again.");
  }
  refresh();
  return { status: "success", message: "Unblocked." };
}
