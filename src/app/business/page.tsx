import type { Metadata } from "next";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui";
import { requireAreaAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Business dashboard" };

const statusLabels = {
  draft: "Not submitted",
  pending_review: "Under review",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
} as const;

export default async function BusinessDashboardPage() {
  const user = await requireAreaAccess("business");
  const supabase = await createClient();
  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name, status, is_verified")
    .eq("owner_id", user.id)
    .order("created_at");

  return (
    <DashboardShell title="Business dashboard" description={user.email}>
      {businesses && businesses.length > 0 ? (
        businesses.map((business) => (
          <Card key={business.id} className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{business.name}</CardTitle>
              <CardDescription>{statusLabels[business.status]}</CardDescription>
            </div>
            {business.is_verified && <Badge tone="verified">Verified</Badge>}
          </Card>
        ))
      ) : (
        <Card>
          <CardTitle>Set up your business</CardTitle>
          <CardDescription>
            Business profiles and verification come next. Once approved, customers can find and book you.
          </CardDescription>
        </Card>
      )}
    </DashboardShell>
  );
}
