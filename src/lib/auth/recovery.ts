import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env/server";

/**
 * Choosing a new password without the current one is only allowed straight after opening a
 * password-reset link: the link's handler sets this short-lived, signed cookie for that account.
 */
const COOKIE = "concierge_pw_reset";
const LIFETIME_SECONDS = 15 * 60;

const sign = (value: string) =>
  createHmac("sha256", getServerEnv().SUPABASE_SERVICE_ROLE_KEY).update(`pw-reset:${value}`).digest("hex");

export function recoveryCookie(userId: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + LIFETIME_SECONDS;
  const value = `${userId}.${expires}`;
  return {
    name: COOKIE,
    value: `${value}.${sign(value)}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: LIFETIME_SECONDS,
    },
  };
}

export function isValidRecovery(cookieValue: string | undefined, userId: string, now = Date.now()): boolean {
  if (!cookieValue) return false;
  const [id, expires, signature] = cookieValue.split(".");
  if (!id || !expires || !signature || id !== userId) return false;
  if (Number(expires) * 1000 < now) return false;
  const expected = Buffer.from(sign(`${id}.${expires}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function hasRecoverySession(userId: string): Promise<boolean> {
  return isValidRecovery((await cookies()).get(COOKIE)?.value, userId);
}

export async function clearRecoverySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
