import { FileText, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel } from "@/components/admin/dashboard-widgets";
import { BookingStatusBadge } from "@/components/bookings/booking-status-badge";
import { Badge, EmptyState } from "@/components/ui";
import { adminChatAccessReason, logAdminChatView } from "@/lib/admin/chat-access";
import {
  moderateMessageAction,
  resolveReportAction,
  restrictConversationAction,
} from "@/lib/admin/chat-actions";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { formatFileSize, reportReasons } from "@/lib/chat/rules";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { pageId } from "@/lib/security/ids";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Chat" };

const statusLabels = { open: "Open", closed: "Closed", locked: "Restricted" } as const;

/**
 * A booking chat, read-only, for settling a dispute or a report. Only reachable when one exists, and
 * every visit is written to the audit log.
 */
export default async function AdminConversationPage({ params }: PageProps<"/admin/conversations/[id]">) {
  const admin = await requireAreaAccess("admin");
  const id = pageId((await params).id);
  const db = createAdminClient();
  const { data: conversation, error } = await db
    .from("conversations")
    .select(
      "id, status, customer_id, created_at, booking:bookings(id, reference, status, scheduled_start), business:businesses(id, name, owner_id), customer:users!conversations_customer_id_fkey(id, full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the chat.", { cause: error });
  if (!conversation) notFound();

  const access = await adminChatAccessReason(conversation.id);
  if (!access) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Private chat" />
        <EmptyState
          title="This chat is private"
          description="Admins can open a booking chat only when there's a dispute on the booking or a report from the chat."
        />
      </div>
    );
  }

  await logAdminChatView(admin, conversation.id, access);

  const [{ data: messages }, { data: reports }, { data: blocks }] = await Promise.all([
    db
      .from("messages")
      .select(
        "id, sender_id, body, attachment_path, attachment_type, attachment_name, attachment_size, is_flagged, hidden_at, created_at",
      )
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(500),
    db
      .from("chat_reports")
      .select("id, reason, details, status, message_id, created_at, reporter_id, resolution")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false }),
    db
      .from("user_blocks")
      .select("blocker_id, blocked_id, created_at")
      .in("blocker_id", [
        conversation.customer_id,
        conversation.business?.owner_id ?? conversation.customer_id,
      ]),
  ]);
  const paths = (messages ?? []).flatMap((m) => (m.attachment_path ? [m.attachment_path] : []));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await db.storage.from("chat-attachments").createSignedUrls(paths, 600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const customerName = conversation.customer?.full_name ?? "Customer";
  const businessName = conversation.business?.name ?? "Business";
  const nameOf = (userId: string) => (userId === conversation.customer_id ? customerName : businessName);
  const reportedMessages = new Set((reports ?? []).flatMap((r) => (r.message_id ? [r.message_id] : [])));
  const block = (blocks ?? []).find(
    (b) => b.blocked_id === conversation.customer_id || b.blocked_id === conversation.business?.owner_id,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Chat · ${conversation.booking?.reference ?? ""}`}
        description={`${customerName} and ${businessName}. Opened because of a ${access.kind}; this visit is in the audit log.`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel title="Messages">
          {(messages ?? []).length === 0 ? (
            <p className="text-sm text-muted">No messages yet.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {(messages ?? []).map((message) => (
                <li
                  key={message.id}
                  id={`message-${message.id}`}
                  className={
                    reportedMessages.has(message.id)
                      ? "rounded-xl border border-danger/40 bg-danger/5 p-3"
                      : "rounded-xl bg-surface-muted p-3"
                  }
                >
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-foreground">{nameOf(message.sender_id)}</span>
                    {formatDateTime(message.created_at)}
                    {reportedMessages.has(message.id) && <Badge tone="danger">Reported</Badge>}
                    {message.hidden_at && <Badge tone="neutral">Hidden from both sides</Badge>}
                  </p>
                  {message.body && (
                    <p className="mt-1 text-sm break-words whitespace-pre-wrap">{message.body}</p>
                  )}
                  {message.attachment_path && (
                    <a
                      href={signed.get(message.attachment_path) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 flex items-center gap-2 text-sm underline"
                    >
                      <FileText aria-hidden className="size-4" />
                      {message.attachment_name ?? message.attachment_type ?? "Attachment"}
                      {message.attachment_size ? ` · ${formatFileSize(message.attachment_size)}` : ""}
                    </a>
                  )}
                  <div className="mt-2">
                    <AdminActionForm
                      action={moderateMessageAction.bind(null, message.hidden_at ? "restore" : "hide")}
                      fields={{ messageId: message.id }}
                      label={message.hidden_at ? "Show again" : "Hide message"}
                      variant="ghost"
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Booking">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Booking</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {conversation.booking && (
                  <>
                    <Link
                      href={adminHref(`/bookings/${conversation.booking.id}`)}
                      className="font-medium hover:underline"
                    >
                      {conversation.booking.reference}
                    </Link>
                    <BookingStatusBadge status={conversation.booking.status} />
                  </>
                )}
              </dd>
              <dt className="text-muted">Date</dt>
              <dd>
                {conversation.booking?.scheduled_start
                  ? formatDateTime(conversation.booking.scheduled_start)
                  : "Not set"}
              </dd>
              <dt className="text-muted">Chat</dt>
              <dd>{statusLabels[conversation.status]}</dd>
              {block && (
                <>
                  <dt className="text-muted">Block</dt>
                  <dd>
                    {block.blocker_id === conversation.customer_id ? customerName : businessName} blocked{" "}
                    {block.blocked_id === conversation.customer_id ? customerName : businessName}
                  </dd>
                </>
              )}
            </dl>
            {conversation.status === "locked" ? (
              <AdminActionForm
                action={restrictConversationAction.bind(null, "unlock")}
                fields={{ conversationId: conversation.id }}
                label="Lift restriction"
              />
            ) : (
              <AdminActionForm
                action={restrictConversationAction.bind(null, "lock")}
                fields={{ conversationId: conversation.id }}
                label="Restrict chat"
                variant="danger"
                reason={{ label: "Reason (both sides are told)", required: true }}
              />
            )}
            <p className="flex items-start gap-2 text-xs text-muted">
              <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />A restricted chat stays readable but
              neither side can send messages.
            </p>
          </Panel>

          <Panel title="Reports">
            {(reports ?? []).length === 0 ? (
              <p className="text-sm text-muted">No reports on this chat.</p>
            ) : (
              <ul className="flex flex-col gap-4 text-sm">
                {(reports ?? []).map((report) => (
                  <li key={report.id} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {reportReasons[report.reason].label}
                      <Badge tone={report.status === "open" ? "danger" : "neutral"}>
                        {report.status === "open"
                          ? "Open"
                          : report.status === "actioned"
                            ? "Action taken"
                            : "Dismissed"}
                      </Badge>
                    </span>
                    <span className="text-muted">
                      By {nameOf(report.reporter_id)} · {report.message_id ? "a message" : "the other person"}{" "}
                      · {formatDateTime(report.created_at)}
                    </span>
                    {report.details && <span>{report.details}</span>}
                    {report.resolution && <span className="text-muted">Resolution: {report.resolution}</span>}
                    {report.status === "open" && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        <AdminActionForm
                          action={resolveReportAction.bind(null, "actioned")}
                          fields={{ reportId: report.id }}
                          label="Action taken"
                          reason={{ label: "What was done", required: false }}
                        />
                        <AdminActionForm
                          action={resolveReportAction.bind(null, "dismissed")}
                          fields={{ reportId: report.id }}
                          label="Dismiss"
                          variant="ghost"
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
