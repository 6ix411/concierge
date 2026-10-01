import "server-only";

import type { FormState } from "@/lib/auth/schemas";
import { requireRole, type SessionUser } from "@/lib/auth/session";
import { AppError, isAppError, logger } from "@/lib/errors";

import { getOwnBusiness, type OwnBusiness } from "./queries";

/** Turns an error into a form message: expected errors show their message, others a safe fallback. */
export function toFormError(error: unknown, fallback: string): FormState {
  if (isAppError(error) && error.status < 500) return { status: "error", message: error.message };
  logger.error(fallback, { error });
  return { status: "error", message: fallback };
}

/** For server actions: the signed-in business owner and their business, verified server-side. */
export async function requireOwnBusinessForAction(): Promise<{ user: SessionUser; business: OwnBusiness }> {
  const user = await requireRole("business");
  const business = await getOwnBusiness(user.id);
  if (!business) throw new AppError("NOT_FOUND", "Register your business first.");
  return { user, business };
}

/** Only follow `next` to pages inside the business dashboard. */
export function businessNextPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  return /^\/business(\/[a-z-]*)*(\?step=[a-z]+)?$/.test(value) ? value : null;
}

/** Storage paths must be inside the business's own folder, with no path tricks. */
export function isOwnStoragePath(businessId: string, path: string): boolean {
  return (
    path.startsWith(`${businessId}/`) && !path.includes("..") && !path.includes("//") && path.length < 300
  );
}

/**
 * The submitted text fields, returned with errors so the form can show what was typed
 * (React resets uncontrolled fields to their defaults after an action).
 */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}
