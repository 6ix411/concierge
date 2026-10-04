"use client";

import { ArrowUp, Loader2, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { askConciergeAction } from "@/lib/concierge/actions";
import type { ChatTurn, ConciergeReply } from "@/lib/concierge/types";

import { AssistantAvatar, AssistantReply } from "./assistant-reply";
import { conciergeExamples } from "./concierge-box";
import { CONNECTION_MESSAGE, isConnectionError } from "@/lib/utils/connection";

export type Turn = { id: string; role: "user" | "assistant"; content: string; reply: ConciergeReply | null };

let counter = 0;
const nextId = () => `local-${++counter}`;

const sameUnderstood = (a: ConciergeReply["understood"], b: ConciergeReply["understood"]) =>
  JSON.stringify(a) === JSON.stringify(b);

export function ConciergeChat({
  initialTurns,
  conversationId: initialConversationId,
  initialQuery,
  recent,
}: {
  initialTurns: Turn[];
  conversationId: string | null;
  initialQuery: string | null;
  recent: { id: string; title: string | null }[];
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const started = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setPending(true);
    const history: ChatTurn[] = turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
      providerIds: turn.reply?.providers.map((provider) => provider.id),
    }));
    setTurns((current) => [...current, { id: nextId(), role: "user", content: message, reply: null }]);
    setDraft("");
    try {
      const result = await askConciergeAction({ message, conversationId, history });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTurns((current) => [
        ...current,
        { id: nextId(), role: "assistant", content: result.reply.message, reply: result.reply },
      ]);
      if (result.conversationId && result.conversationId !== conversationId) {
        setConversationId(result.conversationId);
        window.history.replaceState(null, "", `/concierge?c=${result.conversationId}`);
      }
    } catch (failure) {
      // Nothing reached the concierge: put the message back so it can be sent again.
      setTurns((current) => current.slice(0, -1));
      setDraft(message);
      setError(
        isConnectionError(failure)
          ? CONNECTION_MESSAGE
          : "The concierge is unavailable right now. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  // A request typed on the homepage arrives as ?q= and is sent once.
  useEffect(() => {
    if (started.current || !initialQuery) return;
    started.current = true;
    window.history.replaceState(null, "", "/concierge");
    void send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, pending]);

  const lastAssistant = turns.findLastIndex((turn) => turn.role === "assistant");

  return (
    <div className="flex flex-col gap-6">
      {turns.length === 0 && !pending ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <AssistantAvatar />
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What do you need done?</h1>
            <p className="text-muted">
              Tell me the service, the area, the date and your budget if you know them. I’ll find verified
              businesses on Concierge, compare them and help you start a booking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {conciergeExamples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void send(example)}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
              >
                {example}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Pick up where you left off</h2>
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
                {recent.map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/concierge?c=${conversation.id}`}
                      className="block truncate px-4 py-3 text-sm hover:bg-surface-muted"
                    >
                      {conversation.title ?? "Conversation"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Concierge</h1>
          <Link
            href="/concierge"
            onClick={(event) => {
              event.preventDefault();
              setTurns([]);
              setConversationId(null);
              setError(null);
              window.history.replaceState(null, "", "/concierge");
              inputRef.current?.focus();
            }}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
          >
            <MessageSquarePlus aria-hidden className="size-4" />
            New request
          </Link>
        </div>
      )}

      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation with the concierge"
        className="flex flex-col gap-6"
      >
        {turns.map((turn, index) => {
          if (turn.role === "user") {
            return (
              <div key={turn.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-brand-foreground">
                  {turn.content}
                </p>
              </div>
            );
          }
          if (!turn.reply) return null;
          const previous = turns.slice(0, index).findLast((t) => t.role === "assistant")?.reply;
          return (
            <AssistantReply
              key={turn.id}
              reply={turn.reply}
              showUnderstood={!previous || !sameUnderstood(previous.understood, turn.reply.understood)}
              suggestions={index === lastAssistant && !pending ? turn.reply.suggestions : []}
              onSuggestion={(text) => void send(text)}
            />
          );
        })}
        {pending && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <AssistantAvatar />
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Checking verified providers on Concierge…
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="sticky bottom-(--bottom-nav) z-10 flex flex-col gap-2 border-t border-border bg-background pt-4 pb-2"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-sm">
          <label htmlFor="concierge-message" className="sr-only">
            Message the concierge
          </label>
          <textarea
            ref={inputRef}
            id="concierge-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={turns.length === 0 ? 3 : 1}
            maxLength={1000}
            autoFocus={turns.length === 0 && !initialQuery}
            placeholder={turns.length === 0 ? conciergeExamples[0] : "Reply to the concierge"}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-relaxed outline-none placeholder:text-muted"
          />
          <Button type="submit" size="md" disabled={pending || !draft.trim()} aria-label="Send">
            <ArrowUp aria-hidden className="size-4" />
          </Button>
        </div>
        <p className="text-xs text-muted">
          Only verified businesses registered on Concierge are recommended. Nothing is booked until you
          confirm and pay.
        </p>
      </form>
    </div>
  );
}
