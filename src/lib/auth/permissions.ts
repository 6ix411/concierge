import type { UserRole } from "@/types/roles";

import { adminHref, getAdminPath } from "./admin-path";

/** Protected areas of the app and the roles allowed into each. Admins can enter every area. */
export const areaRoles = {
  account: ["customer", "admin"],
  business: ["business", "admin"],
  admin: ["admin"],
} as const satisfies Record<string, readonly UserRole[]>;

export type ProtectedArea = keyof typeof areaRoles;

/** Public URLs for the customer and business areas. The admin area has a private URL (see admin-path.ts). */
export const areaPaths = {
  account: "/account",
  business: "/business",
} as const satisfies Partial<Record<ProtectedArea, string>>;

export function hasRole(role: UserRole, allowed: readonly UserRole[]): boolean {
  return allowed.includes(role);
}

export function canAccessArea(role: UserRole, area: ProtectedArea): boolean {
  return hasRole(role, areaRoles[area]);
}

/** Where each role lands after signing in. */
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case "customer":
      return areaPaths.account;
    case "business":
      return areaPaths.business;
    case "admin":
      return adminHref();
  }
}

/** Which protected area a public URL belongs to, if any. */
export function areaForPath(pathname: string): ProtectedArea | null {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const adminPath = getAdminPath();
  if (adminPath && under(adminPath)) return "admin";
  if (under(areaPaths.account)) return "account";
  if (under(areaPaths.business)) return "business";
  return null;
}

/** Only allow same-site relative redirects after sign-in (prevents open redirects). */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}
