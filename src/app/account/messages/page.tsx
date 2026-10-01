import type { Metadata } from "next";
import Link from "next/link";

import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { Badge, EmptyState } from "@/components/ui";
import { requireAreaAccess } from "@/lib/auth/session";
import { listCustomerConversations } from "@/lib/chat/queries";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const user = await requireAreaAccess("account");
  const conversations = await listCustomerConversations(user.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      {conversations.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Once a booking is confirmed, you can chat with the business here."
        />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {conversations.map((conversation) => {
            const last = conversation.lastMessage;
            return (
              <li key={conversation.id}>
                <Link
                  href={`/account/messages/${conversation.id}`}
                  className="flex items-center gap-3 p-4 hover:bg-surface-muted"
                >
                  <BusinessAvatar
                    name={conversation.businesses?.name ?? "?"}
                    logoPath={conversation.businesses?.logo_path ?? null}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-2 font-medium">
                        <span className="truncate">{conversation.businesses?.name}</span>
                        {conversation.unread && <Badge tone="accent">New</Badge>}
                      </p>
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
