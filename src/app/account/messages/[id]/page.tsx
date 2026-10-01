import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConversationView } from "@/components/chat/conversation-view";
import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { requireAreaAccess } from "@/lib/auth/session";
import { getConversation } from "@/lib/chat/queries";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/account/messages/[id]">) {
  const user = await requireAreaAccess("account");
  const { id } = await params;
  const conversation = await getConversation(id);
  if (!conversation || conversation.customer_id !== user.id) notFound();

  return (
    <ConversationView
      conversation={conversation}
      viewerId={user.id}
      customerName={user.fullName ?? "You"}
      backHref="/account/messages"
      bookingHref={`/account/bookings/${conversation.booking_id}`}
      avatar={
        <BusinessAvatar
          name={conversation.businesses?.name ?? "Business"}
          logoPath={conversation.businesses?.logo_path ?? null}
          size="sm"
        />
      }
    />
  );
}
