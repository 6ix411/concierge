"use server";

import { refresh } from "next/cache";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import {
  BOOKING_FEE_SETTING,
  bookingFeeSchema,
  describeBookingFee,
  FEATURED_SLOTS_SETTING,
  featuredPackageSchema,
  featuredSlotsSchema,
  planPriceLabel,
  planSchema,
  storeBookingFee,
} from "@/lib/revenue/rules";
import { createAdminClient } from "@/lib/supabase/admin";

/** Edits a plan's name, price, commission and perks. Businesses already paid up keep their period. */
export async function updatePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let message = "Plan saved.";
  try {
    const admin = await requireRole("admin");
    const parsed = planSchema.safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      price: formData.get("price") ?? "",
      commission: formData.get("commission") ?? "",
      perks: formData.get("perks") ?? "",
      active: formData.get("active") === "on",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const plan = parsed.data;
    if (plan.code === "free" && (plan.price !== 0 || !plan.active))
      return { status: "error", fieldErrors: { price: "Free is always ₦0 and always offered." } };

    const db = createAdminClient();
    const { data: previous } = await db
      .from("subscription_plans")
      .select("monthly_price_minor, commission_rate_bps, is_active")
      .eq("code", plan.code)
      .single();
    const { error } = await db
      .from("subscription_plans")
      .update({
        name: plan.name,
        description: plan.description ?? null,
        monthly_price_minor: plan.price,
        commission_rate_bps: plan.commission,
        perks: plan.perks,
        is_active: plan.active,
        updated_by: admin.id,
      })
      .eq("code", plan.code);
    if (error) throw new AppError("INTERNAL", "Could not save the plan.", { cause: error });

    await recordAdminAction(admin, {
      action: "settings.plan",
      targetType: "subscription_plans",
      metadata: {
        plan: plan.code,
        previousPriceMinor: previous?.monthly_price_minor ?? null,
        newPriceMinor: plan.price,
        previousCommissionBps: previous?.commission_rate_bps ?? null,
        newCommissionBps: plan.commission,
        active: plan.active,
      },
    });
    message = `${plan.name} saved: ${planPriceLabel(plan.price)}.`;
  } catch (error) {
    return toFormError(error, "We couldn't save the plan. Please try again.");
  }
  refresh();
  return { status: "success", message };
}

export async function updateFeaturedPackageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = featuredPackageSchema.safeParse({
      code: formData.get("code"),
      price: formData.get("price") ?? "",
      active: formData.get("active") === "on",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { code, price, active } = parsed.data;

    const db = createAdminClient();
    const { data: previous } = await db
      .from("featured_packages")
      .select("price_minor")
      .eq("code", code)
      .maybeSingle();
    if (!previous) throw new AppError("NOT_FOUND", "That option no longer exists.");
    const { error } = await db
      .from("featured_packages")
      .update({ price_minor: price, is_active: active, updated_by: admin.id })
      .eq("code", code);
    if (error) throw new AppError("INTERNAL", "Could not save the price.", { cause: error });

    await recordAdminAction(admin, {
      action: "settings.featured_package",
      targetType: "featured_packages",
      metadata: { package: code, previousPriceMinor: previous.price_minor, newPriceMinor: price, active },
    });
  } catch (error) {
    return toFormError(error, "We couldn't save the price. Please try again.");
  }
  refresh();
  return { status: "success", message: "Price saved." };
}

export async function updateFeaturedSlotsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = featuredSlotsSchema.safeParse({ slots: formData.get("slots") });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const db = createAdminClient();
    const { error } = await db
      .from("platform_settings")
      .upsert({ key: FEATURED_SLOTS_SETTING, value: parsed.data.slots, updated_by: admin.id });
    if (error) throw new AppError("INTERNAL", "Could not save.", { cause: error });
    await recordAdminAction(admin, {
      action: "settings.featured_slots",
      targetType: "platform_settings",
      metadata: { slots: parsed.data.slots },
    });
  } catch (error) {
    return toFormError(error, "We couldn't save that. Please try again.");
  }
  refresh();
  return { status: "success", message: "Saved." };
}

/** The customer booking fee applies to new bookings and new quotes; existing prices don't change. */
export async function updateBookingFeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let message = "Booking fee saved.";
  try {
    const admin = await requireRole("admin");
    const parsed = bookingFeeSchema.safeParse({
      percent: formData.get("percent") ?? "",
      flat: formData.get("flat") ?? "",
      cap: formData.get("cap") ?? "",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

    const db = createAdminClient();
    const { data: current } = await db
      .from("platform_settings")
      .select("value")
      .eq("key", BOOKING_FEE_SETTING)
      .maybeSingle();
    const { error } = await db
      .from("platform_settings")
      .upsert({ key: BOOKING_FEE_SETTING, value: storeBookingFee(parsed.data), updated_by: admin.id });
    if (error) throw new AppError("INTERNAL", "Could not save the booking fee.", { cause: error });

    await recordAdminAction(admin, {
      action: "settings.booking_fee",
      targetType: "platform_settings",
      metadata: { previous: current?.value ?? null, next: storeBookingFee(parsed.data) },
    });
    message = `Booking fee saved: ${describeBookingFee(parsed.data)}. It applies to new bookings.`;
  } catch (error) {
    return toFormError(error, "We couldn't save the booking fee. Please try again.");
  }
  refresh();
  return { status: "success", message };
}
