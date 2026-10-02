"use server";

import { redirect } from "next/navigation";

import { getPublicEnv } from "@/lib/env/client";
import { logger } from "@/lib/errors";
import { logSecurityEvent } from "@/lib/security/events";
import { checkRateLimit, RATE_LIMITED_MESSAGE } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

import { homePathForRole, safeRedirectPath } from "./permissions";
import { clearRecoverySession, hasRecoverySession } from "./recovery";
import {
  fieldErrorsFrom,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type FormState,
} from "./schemas";
import { getSessionUser } from "./session";

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = signUpSchema.safeParse(raw);
  const values = { fullName: raw.fullName ?? "", email: raw.email ?? "", role: raw.role ?? "customer" };
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const { fullName, email, password, role } = parsed.data;
  if (!(await checkRateLimit("auth.sign_up")))
    return { status: "error", message: RATE_LIMITED_MESSAGE, values };
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

  // Per network address, and per account so one account can't be guessed at from many addresses.
  const allowed =
    (await checkRateLimit("auth.sign_in.ip")) &&
    (await checkRateLimit("auth.sign_in.email", parsed.data.email));
  if (!allowed) return { status: "error", message: RATE_LIMITED_MESSAGE, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    await logSecurityEvent("auth.sign_in_failed", { details: { reason: error.code ?? "unknown" } });
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

const RESET_SENT =
  "If there's an account with that email, we've sent a link to choose a new password. It works for an hour.";

/** Sends a password-reset link. The reply is the same whether or not the email has an account. */
export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const values = { email: raw.email ?? "" };
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };
  const allowed =
    (await checkRateLimit("auth.password_reset.ip")) &&
    (await checkRateLimit("auth.password_reset.email", parsed.data.email));
  if (!allowed) return { status: "error", message: RATE_LIMITED_MESSAGE, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getPublicEnv().NEXT_PUBLIC_APP_URL}/auth/confirm?type=recovery`,
  });
  if (error) logger.warn("Password reset email failed", { code: error.code, status: error.status });
  await logSecurityEvent("auth.password_reset_requested");
  return { status: "success", message: RESET_SENT };
}

/** Sets a new password after opening a reset link (see recovery.ts), then signs out everywhere else. */
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user || !(await hasRecoverySession(user.id)))
    return { status: "error", message: "This reset link has expired. Request a new one." };
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    logger.warn("Password reset failed", { code: error.code });
    return {
      status: "error",
      message:
        error.code === "same_password"
          ? "Choose a password you haven't used here."
          : "We couldn't save your new password. Please try again.",
    };
  }
  await supabase.auth.signOut({ scope: "others" });
  await clearRecoverySession();
  await logSecurityEvent("auth.password_reset", { userId: user.id });
  redirect(homePathForRole(user.role));
}
