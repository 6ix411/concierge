"use client";

import { Ban, Flag } from "lucide-react";
import { useState } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui";
import { blockAction, unblockAction } from "@/lib/chat/actions";

import { ReportForm } from "./report-form";
import { useFormAction } from "@/lib/utils/use-form-action";

/** Report the other person, or block / unblock them. */
export function ChatSafety({
  conversationId,
  counterpartName,
  blockedByMe,
}: {
  conversationId: string;
  counterpartName: string;
  blockedByMe: boolean;
}) {
  const [panel, setPanel] = useState<"report" | "block" | null>(null);
  const [blockState, block, blocking] = useFormAction(blockAction.bind(null, conversationId), {
    status: "idle",
  });
  const [unblockState, unblock, unblocking] = useFormAction(unblockAction.bind(null, conversationId), {
    status: "idle",
  });
  const message = blockedByMe ? blockState.message : unblockState.message;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPanel(panel === "report" ? null : "report")}
        >
          <Flag aria-hidden className="size-4" />
          Report {counterpartName}
        </Button>
        {blockedByMe ? (
          <form action={unblock}>
            <Button type="submit" variant="ghost" size="sm" loading={unblocking}>
              <Ban aria-hidden className="size-4" />
              Unblock
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPanel(panel === "block" ? null : "block")}
          >
            <Ban aria-hidden className="size-4" />
            Block
          </Button>
        )}
      </div>
      {message && <FormMessage tone="success">{message}</FormMessage>}
      {panel === "report" && (
        <ReportForm
          conversationId={conversationId}
          title={`Report ${counterpartName}`}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "block" && !blockedByMe && (
        <form
          action={block}
          className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 text-sm"
          onSubmit={() => setPanel(null)}
        >
          <p>
            Block {counterpartName}? Neither of you will be able to send messages here. Your booking
            isn&apos;t affected, and you can unblock at any time.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={blocking}>
              Block
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
