"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { AppError, isAppError, logger } from "@/lib/errors";
import { logSecurityEvent } from "@/lib/security/events";
import { checkRateLimit, RATE_LIMITED_MESSAGE } from "@/lib/security/rate-limit";
import { verifyStoredFile } from "@/lib/security/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { ChatMessage } from "./queries";
import { CHAT_ATTACHMENT_TYPES } from "./rules";

const BUCKET = "chat-attachments";
const MESSAGE_COLUMNS =
  "id, sender_id, body, attachment_path, attachment_type, attachment_name, attachment_size, created_at";

const inputSchema = z.object({
  conversationId: z.guid(),
  path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/),
  name: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).optional(),
});

export type AttachmentResult =
  { ok: true; message: Omit<ChatMessage, "attachment_url"> } | { ok: false; error: string };

/**
 * Sends a message with a file the sender has just uploaded to the conversation's folder. The file
 * is checked by its contents before anyone can see it; anything that isn't really a photo, video,
 * PDF, Word or Excel document or plain text is deleted. Its type is recorded from the contents, not
 * from what the browser said.
 */
export async function sendAttachmentMessageAction(
  input: z.input<typeof inputSchema>,
): Promise<AttachmentResult> {
  try {
    const user = await requireUser();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That file couldn’t be sent." };
    const { conversationId, path, name, body } = parsed.data;
    if (!path.startsWith(`${conversationId}/`)) return { ok: false, error: "That file couldn’t be sent." };

    // Row level security: only the two participants can see the conversation.
    const supabase = await createClient();
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
    if (!(await checkRateLimit("chat.attachment", user.id)))
      return { ok: false, error: RATE_LIMITED_MESSAGE };

    const file = await verifyStoredFile(BUCKET, path, CHAT_ATTACHMENT_TYPES);
    if (!file) {
      await logSecurityEvent("upload.rejected", { userId: user.id, details: { bucket: BUCKET } });
      return {
        ok: false,
        error: "That type of file can't be sent. Photos, videos, PDFs and Word or Excel files are allowed.",
      };
    }

    // The database checks again that the sender is a participant, the chat is open, nobody is
    // blocked, and the file is in this conversation's folder.
    const { data, error } = await createAdminClient()
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: body || null,
        attachment_path: path,
        attachment_type: file.type,
        attachment_name: name,
        attachment_size: file.size,
      })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error || !data) {
      await createAdminClient().storage.from(BUCKET).remove([path]);
      const blocked = error?.message.includes("blocked") || error?.message.includes("restricted");
      const tooFast = error?.message.includes("too quickly");
      return {
        ok: false,
        error: tooFast
          ? "You’re sending messages too quickly. Please wait a moment."
          : blocked
            ? "This conversation can't receive messages right now."
            : "Your message wasn’t sent. Please try again.",
      };
    }
    return { ok: true, message: data };
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { ok: false, error: error.message };
    logger.error("Attachment message failed", { error });
    return { ok: false, error: "Your message wasn’t sent. Please try again." };
  }
}
