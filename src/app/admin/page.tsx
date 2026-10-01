import type { Metadata } from "next";
import Link from "next/link";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAreaAccess("admin");
  const supabase = await createClient();
  const [toReview, openDisputes] = await Promise.all([
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "under_review"]),
    supabase
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "under_review"]),
  ]);

  return (
    <DashboardShell title="Admin" description="Marketplace control centre">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={adminHref("/businesses")} className="rounded-2xl transition hover:opacity-90">
          <Card>
            <CardDescription className="mt-0">Businesses awaiting review</CardDescription>
            <CardTitle className="mt-1 text-3xl">{toReview.count ?? 0}</CardTitle>
          </Card>
        </Link>
        <Card>
          <CardDescription className="mt-0">Open disputes</CardDescription>
          <CardTitle className="mt-1 text-3xl">{openDisputes.count ?? 0}</CardTitle>
        </Card>
      </div>
    </DashboardShell>
  );
}
