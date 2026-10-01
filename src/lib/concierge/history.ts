import "server-only";

import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import { refreshProviders } from "./service";
import type { ChatTurn, ConciergeReply, Requirements } from "./types";

/** Saved with each assistant message so the conversation can be shown again later. */
type ReplyMetadata = Pick<ConciergeReply, "compare" | "booking" | "suggestions" | "understood" | "source"> & {
  requirements: Requirements | null;
};

export type SavedTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reply: ConciergeReply | null;
};

const HISTORY_TURNS = 20;

/** The conversation's recent turns as the concierge sees them. Checks the caller owns it. */
export async function loadHistory(conversationId: string, userId: string): Promise<ChatTurn[] | null> {
  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("ai_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conversation) return null;
  const { data, error } = await admin
    .from("ai_messages")
    .select("role, content, recommended_business_ids")
    .eq("ai_conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);
  if (error) throw new AppError("INTERNAL", "Could not load the conversation.", { cause: error });
  return (data ?? []).reverse().map((row) => ({
    role: row.role as ChatTurn["role"],
    content: row.content,
    providerIds: row.recommended_business_ids,
  }));
}

/** Saves a question and its answer. Written by the server only (customers can read and delete). */
export async function saveTurns(input: {
  userId: string;
  conversationId: string | null;
  message: string;
  reply: ConciergeReply;
  requirements: Requirements | null;
}): Promise<string> {
  const admin = createAdminClient();
  let conversationId = input.conversationId;
  if (!conversationId) {
    const { data, error } = await admin
      .from("ai_conversations")
      .insert({ user_id: input.userId, title: input.message.slice(0, 120) })
      .select("id")
      .single();
    if (error) throw new AppError("INTERNAL", "Could not save the conversation.", { cause: error });
    conversationId = data.id;
  } else {
    await admin
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  const metadata: ReplyMetadata = {
    compare: input.reply.compare,
    booking: input.reply.booking,
    suggestions: input.reply.suggestions,
    understood: input.reply.understood,
    source: input.reply.source,
    requirements: input.requirements,
  };
  const now = Date.now();
  const { error } = await admin.from("ai_messages").insert([
    {
      ai_conversation_id: conversationId,
      role: "user",
      content: input.message,
      recommended_business_ids: [],
      metadata: {},
      created_at: new Date(now).toISOString(),
    },
    {
      ai_conversation_id: conversationId,
      role: "assistant",
      content: input.reply.message,
      recommended_business_ids: input.reply.providers.map((provider) => provider.id),
      metadata: metadata as unknown as NonNullable<Json>,
      created_at: new Date(now + 1).toISOString(),
    },
  ]);
  if (error) throw new AppError("INTERNAL", "Could not save the conversation.", { cause: error });
  return conversationId;
}

/** A saved conversation for display, read through Row Level Security (only the owner sees it). */
export async function getConversation(conversationId: string): Promise<SavedTurn[] | null> {
  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, recommended_business_ids, metadata")
    .eq("ai_conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at")
    .limit(100);
  if (error) throw new AppError("INTERNAL", "Could not load the conversation.", { cause: error });

  return Promise.all(
    (data ?? []).map(async (row) => {
      if (row.role !== "assistant")
        return { id: row.id, role: "user" as const, content: row.content, reply: null };
      const meta = (row.metadata ?? {}) as Partial<ReplyMetadata>;
      return {
        id: row.id,
        role: "assistant" as const,
        content: row.content,
        reply: {
          message: row.content,
          providers: await refreshProviders(row.recommended_business_ids, meta.requirements ?? null),
          compare: meta.compare ?? false,
          booking: meta.booking ?? null,
          suggestions: [],
          understood: meta.understood ?? [],
          source: meta.source ?? "rules",
        },
      };
    }),
  );
}

export async function recentConversations(): Promise<
  { id: string; title: string | null; updated_at: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(5);
  return data ?? [];
}
