import type { Metadata } from "next";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export const metadata: Metadata = { title: "Account not active" };

export default function AccountSuspendedPage() {
  return (
    <DashboardShell
      title="Your account isn’t active"
      description="Your account has been suspended or deactivated. Contact support if you think this is a mistake."
    >
      <div>
        <SignOutButton />
      </div>
    </DashboardShell>
  );
}
