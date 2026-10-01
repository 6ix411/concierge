import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { homePathForRole } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const user = await getSessionUser();
  if (user) redirect(homePathForRole(user.role));

  const { as } = await searchParams;

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {as === "business" ? "Become a Provider" : "Create your account"}
      </h1>
      <p className="mb-6 text-muted">
        {as === "business"
          ? "Create your business account, then register your business. It takes a few minutes."
          : "Book trusted businesses, or list yours for customers to find."}
      </p>
      <SignUpForm defaultRole={as === "business" ? "business" : "customer"} />
    </>
  );
}
