import { AlertCircle, FileText } from "lucide-react";
import type { Metadata } from "next";

import { FormMessage } from "@/components/auth/form-message";
import { StatusCard } from "@/components/business/status-card";
import { VerificationUploader } from "@/components/business/verification-uploader";
import { VerifiedBadge } from "@/components/marketplace/verified-badge";
import { Badge, EmptyState } from "@/components/ui";
import { getStatusNote, getVerificationOverview, requireOwnBusiness } from "@/lib/business/queries";
import { documentStatusInfo, documentTypeLabels } from "@/lib/business/verification";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Verification" };

export default async function BusinessVerificationPage() {
  const { business } = await requireOwnBusiness();
  const [{ documents, requests }, note] = await Promise.all([
    getVerificationOverview(business.id),
    getStatusNote(business.id),
  ]);
  const open = requests.filter((r) => r.status === "open");
  const waiting = requests.filter((r) => r.status === "submitted");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Verification</h1>
        {business.is_verified && <VerifiedBadge />}
      </div>

      <StatusCard status={business.status} note={note} />

      {open.length > 0 && (
        <section aria-labelledby="requests-heading" className="flex flex-col gap-4">
          <h2 id="requests-heading" className="text-lg font-semibold">
            Requested by the Concierge team
          </h2>
          {open.map((request) => (
            <div
              key={request.id}
              className="flex flex-col gap-4 rounded-2xl border border-accent/40 bg-accent/5 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                <div>
                  <p className="font-medium">
                    {request.document_type ? documentTypeLabels[request.document_type] : "More information"}
                  </p>
                  <p className="mt-1 text-sm">{request.message}</p>
                  <p className="mt-1 text-xs text-muted">Asked on {formatDate(request.created_at)}</p>
                </div>
              </div>
              <VerificationUploader
                businessId={business.id}
                requestId={request.id}
                defaultType={request.document_type}
                submitLabel="Send to the Concierge team"
              />
            </div>
          ))}
        </section>
      )}

      {waiting.length > 0 && (
        <FormMessage tone="success">
          You’ve answered {waiting.length} request{waiting.length === 1 ? "" : "s"}. We’ll review your
          {waiting.length === 1 ? " document" : " documents"} shortly.
        </FormMessage>
      )}

      <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
        <h2 id="documents-heading" className="text-lg font-semibold">
          Your documents
        </h2>
        {documents.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-medium">
                    <FileText aria-hidden className="size-4 text-muted" />
                    {documentTypeLabels[doc.document_type]}
                  </span>
                  <Badge tone={documentStatusInfo[doc.status].tone}>
                    {documentStatusInfo[doc.status].label}
                  </Badge>
                </div>
                <p className="text-xs text-muted">
                  Sent {formatDate(doc.created_at)}
                  {doc.document_number && ` · ${doc.document_number}`}
                </p>
                {doc.review_notes && <p className="text-muted">Note from our team: {doc.review_notes}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No documents yet"
            description="Upload your CAC certificate or a government ID so we can verify your business."
          />
        )}
      </section>

      <section aria-labelledby="upload-heading" className="flex flex-col gap-3">
        <h2 id="upload-heading" className="text-lg font-semibold">
          Add a document
        </h2>
        <VerificationUploader businessId={business.id} />
      </section>
    </div>
  );
}
