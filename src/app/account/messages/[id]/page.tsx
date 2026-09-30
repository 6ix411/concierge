import { ChevronLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatThread } from "@/components/chat/chat-thread";
import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { requireAreaAccess } from "@/lib/auth/session";
import { getConversation } from "@/lib/chat/queries";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/account/messages/[id]">) {
  const user = await requireAreaAccess("account");
  const { id } = await params;
  const conversation = await getConversation(id);
  if (!conversation || conversation.customer_id !== user.id) notFound();

  const businessName = conversation.businesses?.name ?? "the business";

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <Link
          href="/account/messages"
          aria-label="Back to messages"
          className="-ml-2 rounded-xl p-2 hover:bg-surface-muted"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <BusinessAvatar name={businessName} logoPath={conversation.businesses?.logo_path ?? null} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{businessName}</p>
          <Link
            href={`/account/bookings/${conversation.booking_id}`}
            className="text-sm text-muted hover:underline"
          >
            Booking {conversation.bookings?.reference}
          </Link>
        </div>
      </header>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
        This chat is just between you and {businessName}. Keep payments on Concierge so your booking stays
        protected.
      </p>
      <ChatThread
        conversationId={conversation.id}
        currentUserId={user.id}
        counterpartName={businessName}
        initialMessages={conversation.messages}
        open={conversation.status === "open"}
      />
    </div>
  );
}
