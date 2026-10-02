import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { Panel } from "@/components/admin/dashboard-widgets";
import { StatusBadge } from "@/components/admin/status-badge";
import { Badge } from "@/components/ui";
import { auditLabel, roleLabels, userStatusInfo } from "@/lib/admin/rules";
import { setUserStatusAction } from "@/lib/admin/user-actions";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { pageId } from "@/lib/security/ids";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  const me = await requireAreaAccess("admin");
  const id = pageId((await params).id);
  const db = createAdminClient();
  const { data: user, error } = await db
    .from("users")
    .select("id, full_name, email, phone, role, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not load the user.", { cause: error });
  if (!user) notFound();

  const [business, bookings, reviews, history] = await Promise.all([
    db.from("businesses").select("id, name, status").eq("owner_id", user.id).maybeSingle(),
    db.from("bookings").select("id", { count: "exact", head: true }).eq("customer_id", user.id),
    db.from("reviews").select("id", { count: "exact", head: true }).eq("customer_id", user.id),
    db
      .from("admin_actions")
      .select("id, action, reason, created_at")
      .eq("target_type", "users")
      .eq("target_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const isMe = user.id === me.id;

  return (
    <div className="flex flex-col gap-6">
      <Link href={adminHref("/users")} className="text-sm text-muted hover:underline">
        Users
      </Link>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{user.full_name ?? user.email}</h1>
          <Badge tone={userStatusInfo[user.status].tone}>{userStatusInfo[user.status].label}</Badge>
        </div>
        <p className="text-sm text-muted">
          {roleLabels[user.role]} · joined {formatDate(user.created_at)}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Email</dt>
            <dd className="break-all">{user.email}</dd>
            <dt className="text-muted">Phone</dt>
            <dd>{user.phone ?? "—"}</dd>
            {user.role === "customer" && (
              <>
                <dt className="text-muted">Bookings</dt>
                <dd>
                  <Link
                    href={adminHref(`/bookings?status=all&customer=${user.id}`)}
                    className="hover:underline"
                  >
                    {bookings.count ?? 0}
                  </Link>
                </dd>
                <dt className="text-muted">Reviews</dt>
                <dd>{reviews.count ?? 0}</dd>
              </>
            )}
            {business.data && (
              <>
                <dt className="text-muted">Business</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <Link href={adminHref(`/businesses/${business.data.id}`)} className="hover:underline">
                    {business.data.name}
                  </Link>
                  <StatusBadge status={business.data.status} />
                </dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Access">
          {isMe ? (
            <p className="text-sm text-muted">This is your account. Another admin can change its status.</p>
          ) : user.status === "active" ? (
            <>
              <p className="text-sm text-muted">
                A suspended user can’t use their account: no booking, messaging or managing a business.
                {user.role === "business" && " Their business is taken off the marketplace too."}
              </p>
              <AdminActionForm
                key="suspend"
                action={setUserStatusAction.bind(null, "suspend")}
                fields={{ userId: user.id }}
                label="Suspend account"
                variant="danger"
                reason={{ label: "Reason (kept in the audit log)", required: true }}
              />
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Reactivating lets them sign in again.
                {user.role === "business" && " Reactivate their business separately from its page."}
              </p>
              <AdminActionForm
                key="reactivate"
                action={setUserStatusAction.bind(null, "reactivate")}
                fields={{ userId: user.id }}
                label="Reactivate account"
                variant="primary"
                reason={{ label: "Note" }}
              />
            </>
          )}
        </Panel>
      </div>

      {(history.data ?? []).length > 0 && (
        <Panel title="History">
          <ul className="flex flex-col gap-1 text-sm">
            {(history.data ?? []).map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3">
                <span>
                  {auditLabel(entry.action)}
                  {entry.reason && <span className="text-muted"> · {entry.reason}</span>}
                </span>
                <span className="shrink-0 text-muted">{formatDateTime(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
