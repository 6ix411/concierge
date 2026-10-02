import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { homePathForRole, safeRedirectPath } from "@/lib/auth/permissions";
import { recoveryCookie } from "@/lib/auth/recovery";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const otpTypes = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

/** Handles the link in confirmation / magic-link / password-reset emails. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type") as EmailOtpType | null;
  const failure = new URL("/sign-in?error=confirmation_failed", request.url);

  const supabase = await createClient();
  if (tokenHash && type && otpTypes.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return NextResponse.redirect(failure);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failure);
  } else {
    return NextResponse.redirect(failure);
  }

  const user = await getSessionUser();
  if (user && type === "recovery") {
    // Only now may this account choose a new password without the current one.
    const response = NextResponse.redirect(new URL("/reset-password", request.url));
    const cookie = recoveryCookie(user.id);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }
  const fallback = user ? homePathForRole(user.role) : "/";
  return NextResponse.redirect(new URL(safeRedirectPath(searchParams.get("next"), fallback), request.url));
}
