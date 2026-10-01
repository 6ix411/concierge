import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConversationView } from "@/components/chat/conversation-view";
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
    <ConversationView
      conversation={conversation}
      viewerId={user.id}
      customerName={customerName}
      backHref="/business/messages"
      bookingHref={`/business/bookings/${conversation.booking_id}`}
      avatar={
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold"
        >
          {initials(customerName)}
        </span>
      }
    />
  );
}
