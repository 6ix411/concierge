"use client";

import { Check, CheckCheck, FileText, Flag, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui";
import type { ChatMessage } from "@/lib/chat/queries";
import {
  ACCEPTED_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  formatFileSize,
  isSeen,
  sharesContactDetails,
} from "@/lib/chat/rules";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

import { ReportForm } from "./report-form";

const MESSAGE_COLUMNS =
  "id, sender_id, body, attachment_path, attachment_type, attachment_name, attachment_size, created_at";

export type ChatAvailability =
  { canSend: true } | { canSend: false; reason: "closed" | "locked" | "blocked_by_me" | "blocked_me" };

const unavailableText = {
  closed: "This conversation is closed because the booking ended.",
  locked: "The Concierge team has restricted this conversation.",
  blocked_by_me: "You blocked this person. Unblock them to send messages again.",
  blocked_me: "You can't send messages in this conversation.",
} as const;

/**
 * Human-to-human chat between a customer and a business. Messages are written straight to the
 * database as the signed-in user; row level security and triggers only let the two participants
 * read or send. Nothing here is generated, suggested, translated or summarised by AI.
 */
export function ChatThread({
  conversationId,
  currentUserId,
  counterpartId,
  counterpartName,
  initialMessages,
  initialCounterpartReadAt,
  availability,
}: {
  conversationId: string;
  currentUserId: string;
  counterpartId: string;
  counterpartName: string;
  initialMessages: ChatMessage[];
  initialCounterpartReadAt: string | null;
  availability: ChatAvailability;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [counterpartReadAt, setCounterpartReadAt] = useState(initialCounterpartReadAt);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const supabase = () => (supabaseRef.current ??= createClient());

  const addMessage = (message: ChatMessage) =>
    setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));

  // Read receipts: tell the other side we've read up to now whenever the chat is open and visible.
  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState === "visible")
        // Query builders only run when awaited or then'd.
        void supabase()
          .rpc("mark_conversation_read", { p_conversation_id: conversationId })
          .then(() => undefined);
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [conversationId, messages.length]);

  useEffect(() => {
    const client = supabase();
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    // Authenticate the realtime socket before joining; otherwise it joins as a visitor and
    // row level security hides every message.
    void client.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      await client.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = client
        .channel(`conversation:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          async (payload) => {
            const row = payload.new as Omit<ChatMessage, "attachment_url">;
            let attachment_url: string | null = null;
            if (row.attachment_path) {
              const { data } = await client.storage
                .from("chat-attachments")
                .createSignedUrl(row.attachment_path, 3600);
              attachment_url = data?.signedUrl ?? null;
            }
            addMessage({ ...row, attachment_url });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversation_reads",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const row = payload.new as { user_id?: string; last_read_at?: string };
            if (row.user_id === counterpartId && row.last_read_at) setCounterpartReadAt(row.last_read_at);
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [conversationId, counterpartId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const chooseFile = (chosen: File | null) => {
    setError(null);
    if (chosen && !ACCEPTED_ATTACHMENTS.includes(chosen.type)) {
      setError("That type of file can't be sent. Photos, videos, PDFs and Word or Excel files are allowed.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (chosen && chosen.size > MAX_ATTACHMENT_BYTES) {
      setError("Files can be up to 50 MB.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(chosen);
  };

  const send = () => {
    const text = body.trim();
    if (!text && !file) return;
    setError(null);
    startSending(async () => {
      const client = supabase();
      let attachment: Pick<
        ChatMessage,
        "attachment_path" | "attachment_type" | "attachment_name" | "attachment_size" | "attachment_url"
      > = {
        attachment_path: null,
        attachment_type: null,
        attachment_name: null,
        attachment_size: null,
        attachment_url: null,
      };

      if (file) {
        const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
        const path = `${conversationId}/${crypto.randomUUID()}-${safeName}`;
        const upload = await client.storage.from("chat-attachments").upload(path, file, {
          contentType: file.type,
        });
        if (upload.error) {
          setError("That file couldn’t be uploaded. Please try again.");
          return;
        }
        const { data } = await client.storage.from("chat-attachments").createSignedUrl(path, 3600);
        attachment = {
          attachment_path: path,
          attachment_type: file.type,
          attachment_name: file.name.slice(0, 200),
          attachment_size: file.size,
          attachment_url: data?.signedUrl ?? null,
        };
      }

      const { attachment_url, ...stored } = attachment;
      const { data, error: insertError } = await client
        .from("messages")
        .insert({ conversation_id: conversationId, sender_id: currentUserId, body: text || null, ...stored })
        .select(MESSAGE_COLUMNS)
        .single();
      if (insertError || !data) {
        setError(
          insertError?.message.includes("blocked") || insertError?.message.includes("restricted")
            ? "This conversation can't receive messages right now."
            : "Your message wasn’t sent. Please try again.",
        );
        return;
      }
      addMessage({ ...data, attachment_url });
      setBody("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const lastMine = messages.findLast((m) => m.sender_id === currentUserId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="flex flex-1 flex-col gap-3 overflow-y-auto py-4" aria-live="polite">
        {messages.length === 0 && (
          <li className="py-8 text-center text-sm text-muted">
            Say hello to {counterpartName} to get started.
          </li>
        )}
        {messages.map((message) => {
          const mine = message.sender_id === currentUserId;
          const seen = mine && isSeen(message.created_at, counterpartReadAt);
          return (
            <li key={message.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
                  mine ? "rounded-br-md bg-brand text-brand-foreground" : "rounded-bl-md bg-surface-muted",
                )}
              >
                {message.attachment_path && <Attachment message={message} />}
                {message.body && <p className="break-words whitespace-pre-wrap">{message.body}</p>}
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                {mine ? "You" : counterpartName} ·{" "}
                <time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time>
                {mine && message.id === lastMine?.id && (
                  <span className="flex items-center gap-0.5" data-testid="receipt">
                    {seen ? (
                      <CheckCheck aria-hidden className="size-3.5 text-verified" />
                    ) : (
                      <Check aria-hidden className="size-3.5" />
                    )}
                    {seen ? "Seen" : "Sent"}
                  </span>
                )}
                {!mine && (
                  <button
                    type="button"
                    onClick={() => setReporting(reporting === message.id ? null : message.id)}
                    className="flex items-center gap-0.5 rounded hover:text-foreground"
                    aria-label="Report this message"
                  >
                    <Flag aria-hidden className="size-3" />
                    Report
                  </button>
                )}
              </span>
              {reporting === message.id && (
                <div className="w-full max-w-md">
                  <ReportForm
                    conversationId={conversationId}
                    messageId={message.id}
                    title="Report this message"
                    onClose={() => setReporting(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
        <div ref={bottomRef} />
      </ol>

      {availability.canSend ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="sticky bottom-16 flex flex-col gap-2 border-t border-border bg-background pt-3 pb-2 md:bottom-0"
        >
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {sharesContactDetails(body) && (
            <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-foreground">
              Looks like you&apos;re sharing contact details. Keeping the conversation and payment on
              Concierge keeps your booking protected.
            </p>
          )}
          {file && (
            <p className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm">
              <span className="truncate">
                {file.name} <span className="text-muted">· {formatFileSize(file.size)}</span>
              </span>
              <button type="button" aria-label="Remove attachment" onClick={() => chooseFile(null)}>
                <X aria-hidden className="size-4" />
              </button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_ATTACHMENTS.join(",")}
              className="sr-only"
              id="chat-file"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <label
              htmlFor="chat-file"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border hover:bg-surface-muted"
            >
              <Paperclip aria-hidden className="size-5" />
              <span className="sr-only">Attach a photo, video or file</span>
            </label>
            <label htmlFor="chat-body" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-body"
              rows={1}
              maxLength={4000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={`Message ${counterpartName}`}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-base placeholder:text-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
            />
            <Button
              type="submit"
              aria-label="Send"
              className="size-11 shrink-0 px-0"
              loading={sending}
              disabled={!body.trim() && !file}
            >
              {!sending && <Send aria-hidden className="size-5" />}
            </Button>
          </div>
        </form>
      ) : (
        <p className="border-t border-border py-4 text-center text-sm text-muted">
          {unavailableText[availability.reason]}
        </p>
      )}
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  if (!message.attachment_url) return <p className="text-sm italic opacity-80">Attachment unavailable</p>;
  const type = message.attachment_type ?? "";
  if (type.startsWith("image/")) {
    return (
      <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mb-1 block">
        {/* Signed URLs expire, so a plain img avoids caching them in the image optimiser. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={message.attachment_url}
          alt={message.attachment_name ?? "Shared photo"}
          className="max-h-64 rounded-xl object-cover"
        />
      </a>
    );
  }
  if (type.startsWith("video/")) {
    return (
      <video
        src={message.attachment_url}
        controls
        preload="metadata"
        className="mb-1 max-h-72 w-full max-w-sm rounded-xl bg-black"
        aria-label={message.attachment_name ?? "Shared video"}
      />
    );
  }
  return (
    <a
      href={message.attachment_url}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 underline underline-offset-2"
    >
      <FileText aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{message.attachment_name ?? "Attachment"}</span>
      {message.attachment_size ? (
        <span className="shrink-0 opacity-80">{formatFileSize(message.attachment_size)}</span>
      ) : null}
    </a>
  );
}
