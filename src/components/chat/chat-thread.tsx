"use client";

import { Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui";
import type { ChatMessage } from "@/lib/chat/queries";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4";

/**
 * Human-to-human chat between a customer and a business. Messages are written straight to the
 * database as the signed-in user; row level security only lets the two participants read or
 * send, and there is no AI sender.
 */
export function ChatThread({
  conversationId,
  currentUserId,
  counterpartName,
  initialMessages,
  open,
}: {
  conversationId: string;
  currentUserId: string;
  counterpartName: string;
  initialMessages: ChatMessage[];
  open: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const supabase = () => (supabaseRef.current ??= createClient());

  const addMessage = (message: ChatMessage) =>
    setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));

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
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = () => {
    const text = body.trim();
    if (!text && !file) return;
    setError(null);
    startSending(async () => {
      const client = supabase();
      let attachment_path: string | null = null;
      let attachment_type: string | null = null;
      let attachment_url: string | null = null;

      if (file) {
        if (file.size > MAX_FILE_BYTES) {
          setError("Files can be up to 20 MB.");
          return;
        }
        const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
        attachment_path = `${conversationId}/${crypto.randomUUID()}-${safeName}`;
        attachment_type = file.type;
        const upload = await client.storage.from("chat-attachments").upload(attachment_path, file, {
          contentType: file.type,
        });
        if (upload.error) {
          setError("That file couldn’t be uploaded. Images, PDFs and MP4 videos up to 20 MB are allowed.");
          return;
        }
        const { data } = await client.storage.from("chat-attachments").createSignedUrl(attachment_path, 3600);
        attachment_url = data?.signedUrl ?? null;
      }

      const { data, error: insertError } = await client
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          body: text || null,
          attachment_path,
          attachment_type,
        })
        .select("id, sender_id, body, attachment_path, attachment_type, created_at")
        .single();
      if (insertError || !data) {
        setError("Your message wasn’t sent. Please try again.");
        return;
      }
      addMessage({ ...data, attachment_url });
      setBody("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

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
          return (
            <li key={message.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
                  mine ? "rounded-br-md bg-brand text-brand-foreground" : "rounded-bl-md bg-surface-muted",
                )}
              >
                {message.attachment_path && <Attachment message={message} />}
                {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
              </div>
              <span className="text-xs text-muted">
                {mine ? "You" : counterpartName} · {formatDateTime(message.created_at)}
              </span>
            </li>
          );
        })}
        <div ref={bottomRef} />
      </ol>

      {open ? (
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
          {file && (
            <p className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm">
              <span className="truncate">{file.name}</span>
              <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)}>
                <X aria-hidden className="size-4" />
              </button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              id="chat-file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <label
              htmlFor="chat-file"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border hover:bg-surface-muted"
            >
              <Paperclip aria-hidden className="size-5" />
              <span className="sr-only">Attach a file</span>
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
          This conversation is closed.
        </p>
      )}
    </div>
  );
}

function Attachment({ message }: { message: ChatMessage }) {
  if (!message.attachment_url) return <p className="text-sm italic opacity-80">Attachment unavailable</p>;
  if (message.attachment_type?.startsWith("image/")) {
    return (
      <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mb-1 block">
        {/* Signed URLs expire, so a plain img avoids caching them in the image optimiser. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={message.attachment_url} alt="Shared image" className="max-h-64 rounded-xl object-cover" />
      </a>
    );
  }
  return (
    <a
      href={message.attachment_url}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 underline"
    >
      <Paperclip aria-hidden className="size-4" />
      {message.attachment_type === "application/pdf" ? "View PDF" : "View attachment"}
    </a>
  );
}
