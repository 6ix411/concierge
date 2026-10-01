"use client";

import { FileUp } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { FormMessage } from "@/components/auth/form-message";
import { Button, Input, Select } from "@/components/ui";
import type { FormState } from "@/lib/auth/schemas";
import { submitVerificationDocumentAction } from "@/lib/business/actions";
import { documentTypeLabels } from "@/lib/business/verification";
import { createClient } from "@/lib/supabase/client";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Uploads a verification document to the private bucket (only the owner and admins can read it),
 * then records it. When answering a platform request, pass its id.
 */
export function VerificationUploader({
  businessId,
  requestId,
  defaultType,
  submitLabel = "Submit document",
}: {
  businessId: string;
  requestId?: string;
  defaultType?: string | null;
  submitLabel?: string;
}) {
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!file) return setState({ status: "error", fieldErrors: { path: "Choose a file to upload." } });
    if (!ACCEPTED.includes(file.type))
      return setState({ status: "error", fieldErrors: { path: "Use a PDF, JPG, PNG or WebP file." } });
    if (file.size > MAX_BYTES)
      return setState({ status: "error", fieldErrors: { path: "Files can be up to 10 MB." } });

    startTransition(async () => {
      const supabase = createClient();
      const ext = file.type === "application/pdf" ? "pdf" : (file.type.split("/")[1] ?? "jpg");
      const path = `${businessId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("verification-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        setState({ status: "error", message: "The upload failed. Check your connection and try again." });
        return;
      }
      const result = await submitVerificationDocumentAction({
        documentType: String(form.get("documentType") ?? ""),
        documentNumber: String(form.get("documentNumber") ?? "") || undefined,
        notes: String(form.get("notes") ?? "") || undefined,
        path,
        requestId,
      });
      setState(result);
      if (result.status === "success") {
        setFile(null);
        formRef.current?.reset();
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {state.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>{state.message}</FormMessage>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Document type" name="documentType" defaultValue={defaultType ?? "cac_certificate"}>
          {Object.entries(documentTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          label="Document number (optional)"
          name="documentNumber"
          placeholder="e.g. RC 1234567"
          maxLength={100}
          error={errors.documentNumber}
        />
      </div>
      <Input label="Notes (optional)" name="notes" maxLength={2000} error={errors.notes} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">File</span>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-surface p-4 text-sm hover:bg-surface-muted">
          <FileUp aria-hidden className="size-5 text-muted" />
          <span className="min-w-0 flex-1 truncate">
            {file ? file.name : "Choose a PDF or photo (up to 10 MB)"}
          </span>
          <input
            type="file"
            accept={ACCEPTED.join(",")}
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {errors.path && <p className="text-sm text-danger">{errors.path}</p>}
        <p className="text-xs text-muted">Only you and the Concierge team can see these documents.</p>
      </div>
      <Button type="submit" loading={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
