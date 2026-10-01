import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import type { getConversation } from "@/lib/chat/queries";
import { formatBookingLocation } from "@/lib/bookings/workflow";
import { formatDateTime } from "@/lib/format";

import { ChatSafety } from "./chat-safety";
import { ChatThread, type ChatAvailability } from "./chat-thread";

type Conversation = NonNullable<Awaited<ReturnType<typeof getConversation>>>;

/**
 * A booking's chat, as the customer or the business sees it: who it's with, the booking it belongs
 * to, safety controls and the messages.
 */
export function ConversationView({
  conversation,
  viewerId,
  customerName,
  backHref,
  bookingHref,
  avatar,
}: {
  conversation: Conversation;
  viewerId: string;
  customerName: string;
  backHref: string;
  bookingHref: string;
  avatar: ReactNode;
}) {
  const businessName = conversation.businesses?.name ?? "Business";
  const viewerIsCustomer = viewerId === conversation.customer_id;
  const counterpartId = viewerIsCustomer
    ? (conversation.businesses?.owner_id ?? "")
    : conversation.customer_id;
  const counterpartName = viewerIsCustomer ? businessName : customerName;
  const booking = conversation.bookings;
  const services = (booking?.booking_items ?? []).filter((i) => i.kind !== "addon").map((i) => i.name);
  const addons = (booking?.booking_items ?? []).filter((i) => i.kind === "addon").map((i) => i.name);
  const location = booking ? formatBookingLocation(booking) : "";
  const counterpartRead = conversation.conversation_reads.find((r) => r.user_id === counterpartId);
  const blockedByMe = conversation.block?.blocker_id === viewerId;

  const availability: ChatAvailability =
    conversation.status === "locked"
      ? { canSend: false, reason: "locked" }
      : conversation.status !== "open"
        ? { canSend: false, reason: "closed" }
        : conversation.block
          ? { canSend: false, reason: blockedByMe ? "blocked_by_me" : "blocked_me" }
          : { canSend: true };

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <Link
          href={backHref}
          aria-label="Back to messages"
          className="-ml-2 rounded-xl p-2 hover:bg-surface-muted"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{counterpartName}</p>
          <Link href={bookingHref} className="text-sm text-muted hover:underline">
            Booking {booking?.reference}
          </Link>
        </div>
      </header>

      <section
        aria-label="Booking details"
        className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl border border-border bg-surface p-3 text-sm"
      >
        <span className="text-muted">Booking</span>
        <span className="flex flex-wrap items-center gap-2">
          <Link href={bookingHref} className="font-medium hover:underline">
            #{booking?.reference}
          </Link>
          {booking && <BookingStatusBadge status={booking.status} />}
        </span>
        <span className="text-muted">Customer</span>
        <span>{customerName}</span>
        <span className="text-muted">Business</span>
        <span>{businessName}</span>
        <span className="text-muted">Service</span>
        <span>
          {services.join(", ") || "Custom request"}
          {addons.length > 0 && <span className="text-muted"> + {addons.join(", ")}</span>}
        </span>
        <span className="text-muted">Date</span>
        <span>{booking?.scheduled_start ? formatDateTime(booking.scheduled_start) : "To be agreed"}</span>
        {location && (
          <>
            <span className="text-muted">Where</span>
            <span>{location}</span>
          </>
        )}
      </section>

      <p className="mt-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
        This chat is private between you and {counterpartName}, for this booking only. No AI reads or writes
        here. Phone numbers aren&apos;t shared; keep talking and paying on Concierge so your booking stays
        protected.
      </p>
      <div className="mt-2">
        <ChatSafety
          conversationId={conversation.id}
          counterpartName={counterpartName}
          blockedByMe={blockedByMe}
        />
      </div>

      <ChatThread
        conversationId={conversation.id}
        currentUserId={viewerId}
        counterpartId={counterpartId}
        counterpartName={counterpartName}
        initialMessages={conversation.messages}
        initialCounterpartReadAt={counterpartRead?.last_read_at ?? null}
        availability={availability}
      />
    </div>
  );
}
