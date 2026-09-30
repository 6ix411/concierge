"use server";

import { redirect } from "next/navigation";

import { getPublicEnv } from "@/lib/env/client";
import { logger } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

import { homePathForRole, safeRedirectPath } from "./permissions";
import { fieldErrorsFrom, signInSchema, signUpSchema, type FormState } from "./schemas";
import { getSessionUser } from "./session";

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = signUpSchema.safeParse(raw);
  const values = { fullName: raw.fullName ?? "", email: raw.email ?? "", role: raw.role ?? "customer" };
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const { fullName, email, password, role } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The database trigger reads these; it ignores any role other than customer/business.
      data: { full_name: fullName, role },
      emailRedirectTo: `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm`,
    },
  });

  if (error) {
    logger.warn("Sign-up failed", { code: error.code, status: error.status });
    const message =
      error.code === "weak_password"
        ? "Choose a stronger password."
        : error.code === "over_email_send_rate_limit"
          ? "Too many attempts. Please wait a minute and try again."
          : "We couldn't create your account. Please try again.";
    return { status: "error", message, values };
  }

  // Email confirmation on: no session yet. Don't reveal whether the email was already registered.
  if (!data.session) {
    return { status: "success", message: "Check your email to confirm your account, then sign in." };
  }
  redirect(homePathForRole(role));
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = signInSchema.safeParse(raw);
  const values = { email: raw.email ?? "" };
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    const message =
      error.code === "email_not_confirmed"
        ? "Please confirm your email first. Check your inbox for the link."
        : "Incorrect email or password.";
    return { status: "error", message, values };
  }

  const user = await getSessionUser();
  if (!user) return { status: "error", message: "We couldn't load your account. Please try again.", values };
  redirect(safeRedirectPath(parsed.data.next, homePathForRole(user.role)));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
