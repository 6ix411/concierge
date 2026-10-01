import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BusinessDecisions,
  DocumentDecision,
  RequestInfoForm,
} from "@/components/admin/business-review-forms";
import { StatusBadge } from "@/components/admin/status-badge";
import { Container } from "@/components/layout/container";
import { BusinessAvatar } from "@/components/marketplace/business-avatar";
import { priceLabel } from "@/components/marketplace/service-list";
import { Badge } from "@/components/ui";
import { decisionsFor } from "@/lib/admin/business-review";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { documentStatusInfo, documentTypeLabels } from "@/lib/business/verification";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, weekdayNames } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Review business" };

const SIGNED_URL_SECONDS = 10 * 60;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function AdminBusinessPage({ params }: PageProps<"/admin/businesses/[id]">) {
  await requireAreaAccess("admin");
  const { id } = await params;
  // Admin-only page: reads with the service role after the admin check above.
  const db = createAdminClient();
  const { data: business, error } = await db
    .from("businesses")
    .select(
      "id, name, slug, description, email, phone, website, address_line, city, state, logo_path, status, status_reason, is_verified, submitted_at, reviewed_at, created_at, owner:users!businesses_owner_id_fkey(full_name, email), primary_category:service_categories(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the business.", { cause: error });
  if (!business) notFound();

  const [services, areas, hours, portfolio, documents, requests, history] = await Promise.all([
    db
      .from("business_services")
      .select("id, name, pricing_type, price_minor, is_package, is_addon, is_active")
      .eq("business_id", id)
      .order("sort_order"),
    db.from("service_areas").select("id, state, area").eq("business_id", id),
    db
      .from("business_availability")
      .select("day_of_week, start_time, end_time")
      .eq("business_id", id)
      .not("day_of_week", "is", null)
      .order("day_of_week"),
    db.from("business_portfolio").select("id").eq("business_id", id),
    db
      .from("business_verifications")
      .select("id, document_type, document_number, notes, document_path, status, review_notes, created_at")
      .eq("business_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("verification_requests")
      .select("id, document_type, message, status, created_at")
      .eq("business_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("admin_actions")
      .select("id, action, reason, created_at")
      .eq("target_type", "businesses")
      .eq("target_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const paths = (documents.data ?? []).map((d) => d.document_path);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await db.storage
      .from("verification-documents")
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const entry of urls ?? [])
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }

  return (
    <Container className="flex flex-col gap-6 py-8">
      <Link href={adminHref("/businesses")} className="text-sm text-muted hover:underline">
        Businesses
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <BusinessAvatar name={business.name} logoPath={business.logo_path} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <StatusBadge status={business.status} />
            {business.primary_category?.name}
            {business.submitted_at && <span>Submitted {formatDateTime(business.submitted_at)}</span>}
          </div>
        </div>
        {business.status === "approved" && (
          <Link
            href={`/businesses/${business.slug}`}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            Public page <ExternalLink aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      <Section title="Decision">
        {business.status_reason && (
          <p className="text-sm text-muted">Last reason: {business.status_reason}</p>
        )}
        <BusinessDecisions businessId={business.id} decisions={decisionsFor(business.status)} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Business information">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Owner</dt>
            <dd>
              {business.owner?.full_name} ({business.owner?.email})
            </dd>
            <dt className="text-muted">Phone</dt>
            <dd>{business.phone ?? "—"}</dd>
            <dt className="text-muted">Email</dt>
            <dd>{business.email ?? "—"}</dd>
            <dt className="text-muted">Website</dt>
            <dd className="break-all">{business.website ?? "—"}</dd>
            <dt className="text-muted">Location</dt>
            <dd>{[business.address_line, business.city, business.state].filter(Boolean).join(", ")}</dd>
            <dt className="text-muted">Areas</dt>
            <dd>
              {(areas.data ?? []).map((a) => (a.area ? `${a.area}, ${a.state}` : a.state)).join("; ") || "—"}
            </dd>
            <dt className="text-muted">Hours</dt>
            <dd>
              {(hours.data ?? [])
                .map(
                  (h) =>
                    `${weekdayNames[h.day_of_week ?? 0]?.slice(0, 3)} ${h.start_time?.slice(0, 5)}–${h.end_time?.slice(0, 5)}`,
                )
                .join(", ") || "—"}
            </dd>
            <dt className="text-muted">Portfolio</dt>
            <dd>{(portfolio.data ?? []).length} items</dd>
          </dl>
          {business.description && <p className="text-sm whitespace-pre-line">{business.description}</p>}
        </Section>

        <Section title="Services">
          <ul className="flex flex-col gap-2 text-sm">
            {(services.data ?? []).map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span>
                  {s.name} {s.is_package && <Badge tone="accent">Package</Badge>}{" "}
                  {s.is_addon && <Badge>Add-on</Badge>} {!s.is_active && <Badge>Hidden</Badge>}
                </span>
                <span className="shrink-0 text-muted">{priceLabel(s)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Verification documents">
        {(documents.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No documents uploaded.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(documents.data ?? []).map((doc) => (
              <li key={doc.id} className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{documentTypeLabels[doc.document_type]}</span>
                  <Badge tone={documentStatusInfo[doc.status].tone}>
                    {documentStatusInfo[doc.status].label}
                  </Badge>
                </div>
                <p className="text-xs text-muted">
                  {formatDate(doc.created_at)}
                  {doc.document_number && ` · No. ${doc.document_number}`}
                  {doc.notes && ` · ${doc.notes}`}
                </p>
                {signed.get(doc.document_path) && (
                  <a
                    href={signed.get(doc.document_path)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1 font-medium hover:underline"
                  >
                    Open document <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                )}
                {doc.review_notes && <p className="text-muted">Note: {doc.review_notes}</p>}
                {doc.status === "pending" && <DocumentDecision verificationId={doc.id} />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Request more information">
        {(requests.data ?? []).length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {(requests.data ?? []).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <span>
                  {r.document_type && (
                    <span className="font-medium">{documentTypeLabels[r.document_type]}: </span>
                  )}
                  {r.message}
                </span>
                <Badge
                  tone={r.status === "open" ? "accent" : r.status === "submitted" ? "neutral" : "verified"}
                >
                  {r.status === "open"
                    ? "Waiting for business"
                    : r.status === "submitted"
                      ? "Answered"
                      : "Closed"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <RequestInfoForm businessId={business.id} />
      </Section>

      {(history.data ?? []).length > 0 && (
        <Section title="History">
          <ul className="flex flex-col gap-1 text-sm">
            {(history.data ?? []).map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3">
                <span>
                  {entry.action.replace("business.", "").replace("_", " ")}
                  {entry.reason && <span className="text-muted"> · {entry.reason}</span>}
                </span>
                <span className="shrink-0 text-muted">{formatDateTime(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Container>
  );
}
