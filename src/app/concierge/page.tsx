import type { Metadata } from "next";
import { z } from "zod";

import { ConciergeChat, type Turn } from "@/components/concierge/concierge-chat";
import { Container } from "@/components/layout/container";
import { getSessionUser } from "@/lib/auth/session";
import { getConversation, recentConversations } from "@/lib/concierge/history";

export const metadata: Metadata = { title: "Concierge" };

export default async function ConciergePage({ searchParams }: PageProps<"/concierge">) {
  const { q, c } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 1000) : "";
  const user = await getSessionUser();

  // Signed-in customers can come back to a saved conversation (read through RLS: only their own).
  let turns: Turn[] = [];
  let conversationId: string | null = null;
  if (user && typeof c === "string" && z.guid().safeParse(c).success) {
    const saved = await getConversation(c);
    if (saved) {
      turns = saved;
      conversationId = c;
    }
  }
  const recent = user && !conversationId && !query ? await recentConversations() : [];

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-6 sm:py-10">
      <ConciergeChat
        key={conversationId ?? "new"}
        initialTurns={turns}
        conversationId={conversationId}
        initialQuery={query || null}
        recent={recent}
      />
    </Container>
  );
}
