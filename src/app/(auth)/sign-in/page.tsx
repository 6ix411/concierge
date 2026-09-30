import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { homePathForRole, safeRedirectPath } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

const notices: Record<string, string> = {
  confirmation_failed: "That link is invalid or has expired. Sign in, or request a new link.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next) : undefined;
  const user = await getSessionUser();
  if (user) redirect(next ?? homePathForRole(user.role));

  const error = typeof params.error === "string" ? notices[params.error] : undefined;

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 text-muted">Sign in to your Concierge account.</p>
      <SignInForm next={next} notice={error} />
    </>
  );
}
