import type { Metadata } from "next";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { PasswordForm, ProfileForm } from "@/components/account/settings-forms";
import { requireAreaAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireAreaAccess("account");
  const supabase = await createClient();
  const [{ data: row }, { data: profile }] = await Promise.all([
    supabase.from("users").select("full_name, phone").eq("id", user.id).single(),
    supabase
      .from("customer_profiles")
      .select("address_line, city, state")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Your details</h2>
          <p className="text-sm text-muted">Signed in as {user.email}</p>
        </div>
        <ProfileForm
          showAddress={user.role === "customer"}
          defaults={{
            fullName: row?.full_name ?? "",
            phone: row?.phone ?? "",
            addressLine: profile?.address_line ?? "",
            city: profile?.city ?? "",
            state: profile?.state ?? "",
          }}
        />
      </section>
      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="font-semibold">Password</h2>
        <PasswordForm />
      </section>
      <section className="border-t border-border pt-6">
        <SignOutButton />
      </section>
    </div>
  );
}
