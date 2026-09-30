import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/roles";

import {
  areaPaths,
  areaRoles,
  canAccessArea,
  hasRole,
  homePathForRole,
  type ProtectedArea,
} from "./permissions";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  status: "active" | "suspended" | "deactivated";
  fullName: string | null;
};

/**
 * The signed-in user, verified server-side on every request.
 * The role comes from the database, never from anything the browser sends.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (error || !userId) return null;

  const { data: row, error: rowError } = await supabase
    .from("users")
    .select("id, email, role, status, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (rowError) throw new AppError("INTERNAL", "Could not load your account.", { cause: rowError });
  if (!row) return null;

  return { id: row.id, email: row.email, role: row.role, status: row.status, fullName: row.full_name };
});

/** For server actions and route handlers: throws AppError (401/403) instead of redirecting. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  if (user.status !== "active")
    throw new AppError("FORBIDDEN", "Your account is not active. Contact support.");
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.role, roles)) throw new AppError("FORBIDDEN", "You don't have permission to do that.");
  return user;
}

/** The caller must own the business (admins pass too unless `allowAdmin` is false). */
export async function requireBusinessOwner(
  businessId: string,
  { allowAdmin = true }: { allowAdmin?: boolean } = {},
): Promise<SessionUser> {
  const user = await requireUser();
  if (allowAdmin && user.role === "admin") return user;
  if (user.role !== "business") throw new AppError("FORBIDDEN", "You don't have permission to do that.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new AppError("INTERNAL", "Could not check business ownership.", { cause: error });
  if (!data) throw new AppError("FORBIDDEN", "You don't have permission to manage this business.");
  return user;
}

/** For pages and layouts: redirects to sign-in, or to the user's own area, instead of throwing. */
export async function requireAreaAccess(area: ProtectedArea): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(areaPaths[area])}`);
  if (user.status !== "active") redirect("/account-suspended");
  if (!canAccessArea(user.role, area)) redirect(homePathForRole(user.role));
  return user;
}

export { areaRoles };
