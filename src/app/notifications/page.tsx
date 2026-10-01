import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Container } from "@/components/layout/container";
import { NotificationCentre } from "@/components/notifications/notification-centre";
import { adminHref } from "@/lib/auth/admin-path";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?next=%2Fnotifications");
  if (user.status !== "active") redirect("/account-suspended");
  // Admins read theirs inside the private dashboard; the redirect only ever reaches an admin.
  if (user.role === "admin") redirect(adminHref("notifications"));

  return (
    <Container className="flex max-w-2xl flex-col gap-6 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Notifications</h1>
      <NotificationCentre userId={user.id} basePath="/notifications" searchParams={await searchParams} />
    </Container>
  );
}
