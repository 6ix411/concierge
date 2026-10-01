"use client";

import { Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatFileSize } from "@/lib/chat/rules";
import { EVIDENCE_TYPES, MAX_EVIDENCE_FILES, evidenceProblem } from "@/lib/disputes/rules";

/**
 * Picks evidence files for a dispute form (field name "files"). Checks type, count and size in the
 * browser; the server checks again. Clears itself when `resetKey` changes (after a successful send).
 */
export function EvidencePicker({ id, error, resetKey }: { id: string; error?: string; resetKey?: unknown }) {
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!input.current) return;
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.current.files = transfer.files;
  }, [files]);

  const [lastReset, setLastReset] = useState(resetKey);
  if (resetKey !== lastReset) {
    setLastReset(resetKey);
    setFiles([]);
    setProblem(null);
  }

  function add(list: FileList | null) {
    const next = [...files, ...Array.from(list ?? [])];
    const found = evidenceProblem(next);
    setProblem(found);
    if (!found) setFiles(next);
    else if (input.current) {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      input.current.files = transfer.files;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        id={id}
        name="files"
        type="file"
        multiple
        accept={EVIDENCE_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => add(event.target.files)}
      />
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2">
              <Paperclip aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-muted">{formatFileSize(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="rounded-full p-1 hover:bg-surface-muted"
                onClick={() => {
                  setProblem(null);
                  setFiles(files.filter((_, i) => i !== index));
                }}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < MAX_EVIDENCE_FILES && (
        <label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 self-start rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted hover:bg-surface-muted"
        >
          <Paperclip aria-hidden className="size-4" />
          Add photos, videos or PDFs
        </label>
      )}
      {(problem ?? error) && <p className="text-sm text-danger">{problem ?? error}</p>}
    </div>
  );
}
