import "server-only";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_url: string | null;
  created_at: string;
};

export const MESSAGE_COLUMNS =
  "id, sender_id, body, attachment_path, attachment_type, attachment_name, attachment_size, created_at";

const SIGNED_URL_SECONDS = 60 * 60;

/** Conversations the signed-in customer takes part in, newest activity first. */
export async function listCustomerConversations(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, status, last_message_at, created_at, bookings(reference), businesses(name, logo_path), conversation_reads(user_id, last_read_at)",
    )
    .eq("customer_id", customerId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new AppError("INTERNAL", "Could not load your messages.", { cause: error });

  const conversations = data ?? [];
  const previews = await Promise.all(
    conversations.map((c) =>
      supabase
        .from("messages")
        .select("body, attachment_path, sender_id, created_at")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  return conversations.map((c, i) => ({
    ...c,
    lastMessage: previews[i]?.data ?? null,
    unread: isUnread(previews[i]?.data ?? null, c.conversation_reads, customerId),
  }));
}

/**
 * One conversation with its booking, latest messages, read receipts and any block between the two
 * people. RLS returns nothing unless the caller is a participant.
 */
export async function getConversation(conversationId: string) {
  const supabase = await createClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select(
      "id, status, customer_id, business_id, booking_id, bookings(reference, status, scheduled_start, area, city, state, booking_items(name, kind)), businesses(name, slug, logo_path, owner_id), conversation_reads(user_id, last_read_at)",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load this conversation.", { cause: error });
  if (!conversation) return null;

  const { data: blocks } = await supabase.from("user_blocks").select("blocker_id, blocked_id");
  const ownerId = conversation.businesses?.owner_id;
  const block =
    (blocks ?? []).find(
      (b) =>
        (b.blocker_id === conversation.customer_id && b.blocked_id === ownerId) ||
        (b.blocker_id === ownerId && b.blocked_id === conversation.customer_id),
    ) ?? null;

  const { data: rows, error: messagesError } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (messagesError) throw new AppError("INTERNAL", "Could not load messages.", { cause: messagesError });

  const paths = (rows ?? []).map((m) => m.attachment_path).filter((p): p is string => Boolean(p));
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("chat-attachments")
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const entry of urls ?? [])
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }

  const messages: ChatMessage[] = (rows ?? []).reverse().map((m) => ({
    ...m,
    attachment_url: m.attachment_path ? (signed.get(m.attachment_path) ?? null) : null,
  }));

  // The street address comes through booking_address, which shows it only to those allowed.
  const { data: addressLine } = await supabase.rpc("booking_address", {
    p_booking_id: conversation.booking_id,
  });
  const bookings = conversation.bookings
    ? { ...conversation.bookings, address_line: addressLine ?? null }
    : null;

  return { ...conversation, bookings, block, messages };
}

/** Conversations for a business the signed-in owner runs, newest activity first. */
export async function listBusinessConversations(businessId: string, ownerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, status, last_message_at, created_at, customer_id, bookings(reference), conversation_reads(user_id, last_read_at)",
    )
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new AppError("INTERNAL", "Could not load your messages.", { cause: error });

  const conversations = data ?? [];
  const [previews, names] = await Promise.all([
    Promise.all(
      conversations.map((c) =>
        supabase
          .from("messages")
          .select("body, attachment_path, sender_id, created_at")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    ),
    getCounterpartNames(conversations.map((c) => c.customer_id)),
  ]);
  return conversations.map((c, i) => ({
    ...c,
    customerName: names.get(c.customer_id) ?? "Customer",
    lastMessage: previews[i]?.data ?? null,
    unread: isUnread(previews[i]?.data ?? null, c.conversation_reads, ownerId),
  }));
}

/** Names (never contact details) of people the caller has a booking with. */
export async function getCounterpartNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_counterparts", { user_ids: unique });
  return new Map((data ?? []).map((row) => [row.id, row.full_name ?? "Customer"]));
}

/** The latest message is from the other person and arrived after I last read the chat. */
function isUnread(
  last: { sender_id: string; created_at: string } | null,
  reads: { user_id: string; last_read_at: string }[],
  viewerId: string,
): boolean {
  if (!last || last.sender_id === viewerId) return false;
  const mine = reads.find((r) => r.user_id === viewerId);
  return !mine || new Date(mine.last_read_at) < new Date(last.created_at);
}
