import type { Metadata } from "next";
import Link from "next/link";

import { FilterTabs, PageHeader } from "@/components/admin/dashboard-widgets";
import { SearchForm } from "@/components/admin/search-form";
import { Badge, EmptyState } from "@/components/ui";
import { roleLabels, userStatusInfo } from "@/lib/admin/rules";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserRole } from "@/types/roles";

export const metadata: Metadata = { title: "Users" };

const tabs = [
  { key: "all", label: "Everyone" },
  { key: "customer", label: "Customers" },
  { key: "business", label: "Business owners" },
  { key: "admin", label: "Admins" },
  { key: "suspended", label: "Suspended" },
] as const;

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  await requireAreaAccess("admin");
  const params = await searchParams;
  const tab = tabs.find((t) => t.key === params.role) ?? tabs[0];
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";

  let query = createAdminClient()
    .from("users")
    .select("id, full_name, email, role, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (isUserRole(tab.key)) query = query.eq("role", tab.key);
  if (tab.key === "suspended") query = query.neq("status", "active");
  if (search) {
    // Strip characters PostgREST uses in filter syntax before building the OR filter.
    const term = search.replace(/[%_,()*\\]/g, "");
    if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw new AppError("INTERNAL", "Could not load users.", { cause: error });
  const users = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Customers, business owners and admins. Open someone to manage their account."
      />
      <FilterTabs
        label="Filter users"
        current={tab.key}
        tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: adminHref(`/users?role=${t.key}`) }))}
      />
      <SearchForm
        action={adminHref("/users")}
        defaultValue={search}
        label="Search users"
        placeholder="Name or email"
      >
        <input type="hidden" name="role" value={tab.key} />
      </SearchForm>
      {users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {users.map((user) => (
            <li key={user.id}>
              <Link
                href={adminHref(`/users/${user.id}`)}
                className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{user.full_name ?? "No name"}</span>
                  <span className="block truncate text-sm text-muted">{user.email}</span>
                  <span className="block text-xs text-muted">
                    {roleLabels[user.role]} · joined {formatDate(user.created_at)}
                  </span>
                </span>
                {user.status !== "active" && (
                  <Badge tone={userStatusInfo[user.status].tone}>{userStatusInfo[user.status].label}</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
