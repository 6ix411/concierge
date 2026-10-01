import "server-only";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  attachment_type: string | null;
  attachment_url: string | null;
  created_at: string;
};

const SIGNED_URL_SECONDS = 60 * 60;

/** Conversations the signed-in customer takes part in, newest activity first. */
export async function listCustomerConversations(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, status, last_message_at, created_at, bookings(reference), businesses(name, logo_path)")
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
  return conversations.map((c, i) => ({ ...c, lastMessage: previews[i]?.data ?? null }));
}

/** One conversation with its latest messages. RLS returns nothing unless the caller is a participant. */
export async function getConversation(conversationId: string) {
  const supabase = await createClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select(
      "id, status, customer_id, business_id, booking_id, bookings(reference, status), businesses(name, slug, logo_path, owner_id)",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load this conversation.", { cause: error });
  if (!conversation) return null;

  const { data: rows, error: messagesError } = await supabase
    .from("messages")
    .select("id, sender_id, body, attachment_path, attachment_type, created_at")
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

  return { ...conversation, messages };
}

/** Conversations for a business the signed-in owner runs, newest activity first. */
export async function listBusinessConversations(businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, status, last_message_at, created_at, customer_id, bookings(reference)")
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
