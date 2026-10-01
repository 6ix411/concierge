import { ChevronLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatThread } from "@/components/chat/chat-thread";
import { requireOwnBusiness } from "@/lib/business/queries";
import { getConversation, getCounterpartNames } from "@/lib/chat/queries";
import { initials } from "@/lib/format";

export const metadata: Metadata = { title: "Conversation" };

export default async function BusinessConversationPage({ params }: PageProps<"/business/messages/[id]">) {
  const { user, business } = await requireOwnBusiness();
  const { id } = await params;
  const conversation = await getConversation(id);
  if (!conversation || conversation.business_id !== business.id) notFound();
  const customerName =
    (await getCounterpartNames([conversation.customer_id])).get(conversation.customer_id) ?? "Customer";

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <Link
          href="/business/messages"
          aria-label="Back to messages"
          className="-ml-2 rounded-xl p-2 hover:bg-surface-muted"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold"
        >
          {initials(customerName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{customerName}</p>
          <Link
            href={`/business/bookings/${conversation.booking_id}`}
            className="text-sm text-muted hover:underline"
          >
            Booking {conversation.bookings?.reference}
          </Link>
        </div>
      </header>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
        This chat is just between you and {customerName}. Keep payments on Concierge so the booking stays
        protected.
      </p>
      <ChatThread
        conversationId={conversation.id}
        currentUserId={user.id}
        counterpartName={customerName}
        initialMessages={conversation.messages}
        open={conversation.status === "open"}
      />
    </div>
  );
}
