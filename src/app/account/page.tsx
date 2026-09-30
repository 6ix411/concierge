import type { Metadata } from "next";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui";
import { requireAreaAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireAreaAccess("account");
  return (
    <DashboardShell
      title={`Hi${user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}`}
      description={user.email}
    >
      <Card>
        <CardTitle>Your bookings</CardTitle>
        <CardDescription>Bookings you make will show up here.</CardDescription>
      </Card>
    </DashboardShell>
  );
}
