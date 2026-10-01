import { FileText, Lock } from "lucide-react";

import { disputeStatusInfo, type DisputeStatus } from "@/lib/admin/rules";
import { formatFileSize } from "@/lib/chat/rules";
import type { DisputeThread as Thread } from "@/lib/disputes/queries";
import { disputeRoleLabels, type DisputeRole } from "@/lib/disputes/rules";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

type Evidence = Thread["evidence"][number];
type Viewer = DisputeRole;

/** One evidence file: a photo, a playable video or a PDF link. */
export function EvidenceItem({ file }: { file: Evidence }) {
  if (!file.url) return <p className="text-sm text-muted italic">{file.file_name} (unavailable)</p>;
  if (file.mime_type.startsWith("image/"))
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="block">
        {/* Signed links expire, so a plain img avoids caching them in the image optimiser. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={file.url}
          alt={file.file_name}
          loading="lazy"
          className="size-28 rounded-xl border border-border object-cover"
        />
      </a>
    );
  if (file.mime_type.startsWith("video/"))
    return (
      <video
        src={file.url}
        controls
        preload="metadata"
        aria-label={file.file_name}
        className="max-h-56 w-full max-w-xs rounded-xl bg-black"
      />
    );
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface-muted"
    >
      <FileText aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{file.file_name}</span>
      <span className="shrink-0 text-muted">{formatFileSize(file.size_bytes)}</span>
    </a>
  );
}

/** Every file in the dispute, newest last, with who added it. */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="text-sm text-muted">No evidence added yet.</p>;
  return (
    <ul className="flex flex-wrap gap-4" aria-label="Evidence">
      {evidence.map((file) => (
        <li key={file.id} className="flex max-w-xs flex-col gap-1">
          <EvidenceItem file={file} />
          <span className="text-xs text-muted">
            {disputeRoleLabels[file.uploader_role as DisputeRole]} · {formatDateTime(file.created_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function statusLine(from: string | null, to: string | null) {
  const label = (s: string | null) => (s ? (disputeStatusInfo[s as DisputeStatus]?.label ?? s) : "");
  return from ? `${label(from)} → ${label(to)}` : label(to);
}

/**
 * The dispute's history and conversation in order: when it was opened, each status change, and
 * every message with its files. Nobody can edit or delete any of it.
 */
export function DisputeThread({ thread, viewer }: { thread: Thread; viewer: Viewer }) {
  const filesByMessage = new Map<string, Evidence[]>();
  for (const file of thread.evidence)
    if (file.message_id)
      filesByMessage.set(file.message_id, [...(filesByMessage.get(file.message_id) ?? []), file]);

  type Entry =
    | { kind: "event"; at: string; item: Thread["events"][number] }
    | { kind: "message"; at: string; item: Thread["messages"][number] }
    | { kind: "files"; at: string; item: Evidence };
  const entries: Entry[] = [
    ...thread.events
      .filter((e) => e.event !== "message")
      .map((item) => ({ kind: "event" as const, at: item.created_at, item })),
    ...thread.messages.map((item) => ({ kind: "message" as const, at: item.created_at, item })),
    ...thread.evidence
      .filter((f) => !f.message_id)
      .map((item) => ({ kind: "files" as const, at: item.created_at, item })),
  ].toSorted((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="flex flex-col gap-3" aria-label="Dispute history">
      {entries.map((entry) => {
        if (entry.kind === "event") {
          const e = entry.item;
          return (
            <li key={`e-${e.id}`} className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <span className="font-medium text-foreground">
                {e.event === "opened"
                  ? `Opened by the ${disputeRoleLabels[(e.actor_role ?? "system") as DisputeRole].toLowerCase()}`
                  : statusLine(e.from_status, e.to_status)}
              </span>
              {e.event === "status_changed" && e.actor_role && (
                <span>
                  by{" "}
                  {e.actor_role === "admin"
                    ? "the Concierge team"
                    : e.actor_role === "customer" || e.actor_role === "business"
                      ? `the ${e.actor_role}`
                      : "Concierge"}
                </span>
              )}
              <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
            </li>
          );
        }
        if (entry.kind === "files") {
          // The file itself is shown under Evidence; the history just records who added what, when.
          const f = entry.item;
          return (
            <li key={`f-${f.id}`} className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <span className="font-medium text-foreground">
                {disputeRoleLabels[f.uploader_role as DisputeRole]} added{" "}
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {f.file_name}
                  </a>
                ) : (
                  f.file_name
                )}
              </span>
              <time dateTime={f.created_at}>{formatDateTime(f.created_at)}</time>
            </li>
          );
        }
        const m = entry.item;
        const mine = m.sender_role === viewer;
        return (
          <li
            key={`m-${m.id}`}
            className={cn(
              "flex max-w-xl flex-col gap-2 rounded-2xl border p-3 text-sm",
              m.internal ? "border-dashed border-accent bg-accent/5" : "border-border bg-surface",
              mine && "self-end",
            )}
          >
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-medium text-foreground">
                {disputeRoleLabels[m.sender_role as DisputeRole]}
              </span>
              {m.internal && (
                <span className="inline-flex items-center gap-1">
                  <Lock aria-hidden className="size-3" /> Internal note
                </span>
              )}
              <time dateTime={m.created_at}>{formatDateTime(m.created_at)}</time>
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
            {(filesByMessage.get(m.id) ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(filesByMessage.get(m.id) ?? []).map((file) => (
                  <EvidenceItem key={file.id} file={file} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
