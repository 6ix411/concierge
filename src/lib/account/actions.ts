"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import { logger } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(
      z.union([
        z.literal(""),
        z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number, e.g. +2348012345678."),
      ]),
    )
    .transform((value) => value || null),
  addressLine: optional(300),
  city: optional(80),
  state: optional(80),
});

/** Updates the caller's own details. RLS and column grants limit this to their own name, phone and address. */
export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ full_name: input.fullName, phone: input.phone })
    .eq("id", user.id);
  if (error) {
    logger.error("Profile update failed", { error });
    return { status: "error", message: "We couldn't save your details. Please try again." };
  }
  if (user.role === "customer") {
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .update({ address_line: input.addressLine, city: input.city, state: input.state })
      .eq("user_id", user.id);
    if (profileError) {
      logger.error("Customer profile update failed", { error: profileError });
      return { status: "error", message: "We couldn't save your address. Please try again." };
    }
  }
  refresh();
  return { status: "success", message: "Saved." };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(8, "Use at least 8 characters.")
      .max(72)
      .regex(/[A-Za-z]/, "Include at least one letter.")
      .regex(/[0-9]/, "Include at least one number."),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Choose a password you haven't used here.",
  });

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { error: checkError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (checkError) return { status: "error", fieldErrors: { currentPassword: "That password isn't right." } };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) {
    logger.warn("Password change failed", { code: error.code });
    return { status: "error", message: "We couldn't change your password. Please try again." };
  }
  return { status: "success", message: "Password changed." };
}

export async function markNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  refresh();
}
