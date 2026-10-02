import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { FormMessage } from "@/components/auth/form-message";
import { hasRecoverySession } from "@/lib/auth/recovery";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage() {
  const user = await getSessionUser();
  const allowed = user ? await hasRecoverySession(user.id) : false;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Choose a new password</h1>
      {allowed ? (
        <>
          <p className="mb-6 text-muted">You’ll be signed out on your other devices.</p>
          <ResetPasswordForm />
        </>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <FormMessage tone="error">This reset link has expired or was already used.</FormMessage>
          <Link
            href="/forgot-password"
            className="text-center text-sm font-medium underline underline-offset-4"
          >
            Request a new link
          </Link>
        </div>
      )}
    </>
  );
}
