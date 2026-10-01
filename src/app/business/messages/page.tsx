import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui";
import { requireOwnBusiness } from "@/lib/business/queries";
import { listBusinessConversations } from "@/lib/chat/queries";
import { formatDateTime, initials } from "@/lib/format";

export const metadata: Metadata = { title: "Messages" };

export default async function BusinessMessagesPage() {
  const { user, business } = await requireOwnBusiness();
  const conversations = await listBusinessConversations(business.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      {conversations.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="A chat with the customer opens when a booking is paid and confirmed."
        />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {conversations.map((conversation) => {
            const last = conversation.lastMessage;
            return (
              <li key={conversation.id}>
                <Link
                  href={`/business/messages/${conversation.id}`}
                  className="flex items-center gap-3 p-4 hover:bg-surface-muted"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold"
                  >
                    {initials(conversation.customerName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{conversation.customerName}</p>
                      {last && (
                        <span className="shrink-0 text-xs text-muted">{formatDateTime(last.created_at)}</span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted">
                      {last
                        ? `${last.sender_id === user.id ? "You: " : ""}${last.body ?? "Sent an attachment"}`
                        : `Booking ${conversation.bookings?.reference}`}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
