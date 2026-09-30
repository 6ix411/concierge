/** Mirrors the `user_role` enum in supabase/migrations. */
export const userRoles = ["customer", "business", "admin"] as const;
export type UserRole = (typeof userRoles)[number];

/** Roles a person may choose at sign-up. Admins are only ever granted by another admin. */
export const selfServiceRoles = ["customer", "business"] as const satisfies readonly UserRole[];
export type SelfServiceRole = (typeof selfServiceRoles)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (userRoles as readonly string[]).includes(value);
}
