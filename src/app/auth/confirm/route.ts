import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { homePathForRole, safeRedirectPath } from "@/lib/auth/permissions";
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

/** Handles the link in confirmation / magic-link / recovery emails. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const failure = new URL("/sign-in?error=confirmation_failed", request.url);

  if (!tokenHash || !type || !otpTypes.has(type)) return NextResponse.redirect(failure);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(failure);

  const user = await getSessionUser();
  const fallback = user ? homePathForRole(user.role) : "/";
  return NextResponse.redirect(new URL(safeRedirectPath(searchParams.get("next"), fallback), request.url));
}
