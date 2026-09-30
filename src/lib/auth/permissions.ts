import type { UserRole } from "@/types/roles";

/** Protected areas of the app and the roles allowed into each. Admins can enter every area. */
export const areaRoles = {
  account: ["customer", "admin"],
  business: ["business", "admin"],
  admin: ["admin"],
} as const satisfies Record<string, readonly UserRole[]>;

export type ProtectedArea = keyof typeof areaRoles;

export const areaPaths: Record<ProtectedArea, string> = {
  account: "/account",
  business: "/business",
  admin: "/admin",
};

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
      return areaPaths.admin;
  }
}

/** Which protected area a path belongs to, if any. */
export function areaForPath(pathname: string): ProtectedArea | null {
  for (const [area, path] of Object.entries(areaPaths) as [ProtectedArea, string][]) {
    if (pathname === path || pathname.startsWith(`${path}/`)) return area;
  }
  return null;
}

/** Only allow same-site relative redirects after sign-in (prevents open redirects). */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}
