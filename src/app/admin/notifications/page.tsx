import type { Metadata } from "next";

import { NotificationCentre } from "@/components/notifications/notification-centre";
import { adminHref } from "@/lib/auth/admin-path";
import { requireAreaAccess } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function AdminNotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  const admin = await requireAreaAccess("admin");
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <NotificationCentre
        userId={admin.id}
        basePath={adminHref("notifications")}
        searchParams={await searchParams}
      />
    </div>
  );
}
