"use server";

import { refresh } from "next/cache";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import { COMMISSION_SETTING, formatBps } from "./rules";
import { businessCommissionSchema, commissionSchema } from "./schemas";

/** Sets the platform commission for new bookings. Existing bookings keep the rate they were made at. */
export async function updateCommissionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let message = "Commission saved.";
  try {
    const admin = await requireRole("admin");
    const parsed = commissionSchema.safeParse({ percent: formData.get("percent") });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const bps = parsed.data.percent;

    const db = createAdminClient();
    const { data: current } = await db
      .from("platform_settings")
      .select("value")
      .eq("key", COMMISSION_SETTING)
      .maybeSingle();
    const previous = current ? Number(current.value) : null;
    const { error } = await db
      .from("platform_settings")
      .upsert({ key: COMMISSION_SETTING, value: bps, updated_by: admin.id });
    if (error) throw new AppError("INTERNAL", "Could not save the commission.", { cause: error });

    await recordAdminAction(admin, {
      action: "settings.commission",
      targetType: "platform_settings",
      metadata: { previousBps: previous, newBps: bps },
    });
    message = `Commission set to ${formatBps(bps)} for new bookings.`;
  } catch (error) {
    return toFormError(error, "We couldn't save the commission. Please try again.");
  }
  refresh();
  return { status: "success", message };
}

/** A business-specific rate, or back to the platform default when left empty. */
export async function setBusinessCommissionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let message = "Commission saved.";
  try {
    const admin = await requireRole("admin");
    const parsed = businessCommissionSchema.safeParse({
      businessId: formData.get("businessId"),
      percent: formData.get("percent") ?? "",
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { businessId, percent } = parsed.data;

    const db = createAdminClient();
    const { data: business } = await db
      .from("businesses")
      .select("id, name, commission_rate_bps")
      .eq("id", businessId)
      .maybeSingle();
    if (!business) throw new AppError("NOT_FOUND", "Business not found.");
    const { error } = await db
      .from("businesses")
      .update({ commission_rate_bps: percent })
      .eq("id", business.id);
    if (error) throw new AppError("INTERNAL", "Could not save the commission.", { cause: error });

    await recordAdminAction(admin, {
      action: "business.commission",
      targetType: "businesses",
      targetId: business.id,
      metadata: { previousBps: business.commission_rate_bps, newBps: percent },
    });
    message =
      percent === null
        ? `${business.name} now uses the platform commission.`
        : `${business.name} now pays ${formatBps(percent)} on new bookings.`;
  } catch (error) {
    return toFormError(error, "We couldn't save the commission. Please try again.");
  }
  refresh();
  return { status: "success", message };
}
