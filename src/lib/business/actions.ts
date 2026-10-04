"use server";

import { refreshPage } from "@/lib/utils/refresh";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { getSessionUser, requireRole } from "@/lib/auth/session";
import { lagosToday } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { activeAdminIds, notify } from "@/lib/notifications";
import { logSecurityEvent } from "@/lib/security/events";
import { DOCUMENT_TYPES, IMAGE_TYPES, VIDEO_TYPES, type SniffedType } from "@/lib/security/files";
import { verifyStoredFile } from "@/lib/security/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  businessNextPath,
  formValues,
  isOwnStoragePath,
  requireOwnBusinessForAction,
  toFormError,
} from "./action-utils";
import { missingSteps } from "./onboarding";
import { getOnboardingProgress, getOwnBusiness } from "./queries";
import {
  blockedDateSchema,
  bookingSettingsSchema,
  businessDetailsSchema,
  portfolioItemSchema,
  serviceAreaSchema,
  serviceSchema,
  verificationDocumentSchema,
  weeklyHoursSchema,
} from "./schemas";
import { slugify, uniqueSlug } from "./slug";
import { canSubmitForReview } from "./status";

// Owner-managed content (profile, services, areas, hours, portfolio, documents) is written with
// the owner's own session, so row level security and column grants apply. Only status changes
// and cross-table bookkeeping use the service role, after the checks above them.

const saved = (message = "Saved."): FormState => ({ status: "success", message });

function detailsFrom(formData: FormData) {
  return businessDetailsSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    website: formData.get("website") || undefined,
    addressLine: formData.get("addressLine") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
  });
}

/** Step 1 of registration: creates the business as a draft. One business per account. */
export async function createBusinessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireRole("business");
    if (!(await getOwnBusiness(user.id))) {
      const parsed = detailsFrom(formData);
      if (!parsed.success)
        return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values: formValues(formData) };
      const input = parsed.data;

      // Slugs are unique across every business, including ones customers can't see.
      const base = slugify(input.name);
      const { data: existing } = await createAdminClient()
        .from("businesses")
        .select("slug")
        .like("slug", `${base}%`);
      const slug = uniqueSlug(base, new Set((existing ?? []).map((row) => row.slug)));

      const supabase = await createClient();
      const { error } = await supabase.from("businesses").insert({
        owner_id: user.id,
        name: input.name,
        slug,
        description: input.description,
        primary_category_id: input.categoryId,
        phone: input.phone ?? null,
        email: input.email ?? null,
        website: input.website ?? null,
        address_line: input.addressLine ?? null,
        city: input.city,
        state: input.state,
      });
      // 23505 on owner_id: a double submit already created it.
      if (error && error.code !== "23505")
        throw new AppError("INTERNAL", "Could not create your business.", { cause: error });
    }
  } catch (error) {
    return {
      ...toFormError(error, "We couldn't save your business. Please try again."),
      values: formValues(formData),
    };
  }
  redirect("/business/setup?step=areas");
}

export async function updateBusinessDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let next: string | null = null;
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = detailsFrom(formData);
    if (!parsed.success)
      return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values: formValues(formData) };
    const input = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase
      .from("businesses")
      .update({
        name: input.name,
        description: input.description,
        primary_category_id: input.categoryId,
        phone: input.phone ?? null,
        email: input.email ?? null,
        website: input.website ?? null,
        address_line: input.addressLine ?? null,
        city: input.city,
        state: input.state,
      })
      .eq("id", business.id);
    if (error) throw new AppError("INTERNAL", "Could not save your details.", { cause: error });
    next = businessNextPath(formData.get("next"));
  } catch (error) {
    return {
      ...toFormError(error, "We couldn't save your details. Please try again."),
      values: formValues(formData),
    };
  }
  if (next) redirect(next);
  refreshPage();
  return saved("Business details saved.");
}

// ---------------------------------------------------------------------------
// Service areas
// ---------------------------------------------------------------------------

export async function addServiceAreaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = serviceAreaSchema.safeParse({
      state: formData.get("state"),
      area: formData.get("area") || undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const supabase = await createClient();
    const { error } = await supabase.from("service_areas").insert({
      business_id: business.id,
      state: parsed.data.state,
      area: parsed.data.area ?? null,
    });
    if (error?.code === "23505") return { status: "error", message: "You've already added that area." };
    if (error) throw new AppError("INTERNAL", "Could not add the area.", { cause: error });
  } catch (error) {
    return toFormError(error, "We couldn't add that area. Please try again.");
  }
  refreshPage();
  return saved("Area added.");
}

export async function removeServiceAreaAction(areaId: string): Promise<void> {
  const { business } = await requireOwnBusinessForAction();
  if (!isId(areaId)) return;
  const supabase = await createClient();
  await supabase.from("service_areas").delete().eq("id", areaId).eq("business_id", business.id);
  refreshPage();
}

// ---------------------------------------------------------------------------
// Services, packages and add-ons
// ---------------------------------------------------------------------------

export async function saveServiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = serviceSchema.safeParse({
      serviceId: formData.get("serviceId") || undefined,
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      categoryId: formData.get("categoryId") ?? "",
      kind: formData.get("kind"),
      pricingType: formData.get("pricingType"),
      price: formData.get("price") ?? undefined,
      durationMinutes: formData.get("durationMinutes") ?? "",
      includes: formData.get("includes") ?? undefined,
      isActive: formData.get("isActive") === "on",
    });
    if (!parsed.success)
      return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values: formValues(formData) };
    const { serviceId, row } = parsed.data;

    const supabase = await createClient();
    if (serviceId) {
      const { data, error } = await supabase
        .from("business_services")
        .update(row)
        .eq("id", serviceId)
        .eq("business_id", business.id)
        .select("id");
      if (error) throw new AppError("INTERNAL", "Could not save the service.", { cause: error });
      if (!data?.length) throw new AppError("NOT_FOUND", "That service no longer exists.");
    } else {
      const { count } = await supabase
        .from("business_services")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id);
      const { error } = await supabase
        .from("business_services")
        .insert({ ...row, business_id: business.id, sort_order: count ?? 0 });
      if (error) throw new AppError("INTERNAL", "Could not add the service.", { cause: error });
    }
  } catch (error) {
    return {
      ...toFormError(error, "We couldn't save that service. Please try again."),
      values: formValues(formData),
    };
  }
  refreshPage();
  return saved("Service saved.");
}

export async function deleteServiceAction(serviceId: string): Promise<void> {
  const { business } = await requireOwnBusinessForAction();
  if (!isId(serviceId)) return;
  const supabase = await createClient();
  // Past bookings keep their own copy of the name and price, so deleting is safe.
  await supabase.from("business_services").delete().eq("id", serviceId).eq("business_id", business.id);
  refreshPage();
}

// ---------------------------------------------------------------------------
// Availability: weekly hours, booking rules and days off
// ---------------------------------------------------------------------------

export async function saveWeeklyHoursAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let next: string | null = null;
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = weeklyHoursSchema.safeParse(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        open: formData.get(`open-${day}`) === "on",
        start: String(formData.get(`start-${day}`) ?? ""),
        end: String(formData.get(`end-${day}`) ?? ""),
      })),
    );
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[`day-${String(issue.path[0])}`] ??= issue.message;
      return {
        status: "error",
        message: "Check the highlighted days.",
        fieldErrors,
        values: formValues(formData),
      };
    }
    const open = parsed.data.filter((day) => day.open);
    if (open.length === 0)
      return { status: "error", message: "Open at least one day a week.", values: formValues(formData) };

    const supabase = await createClient();
    const { error: deleteError } = await supabase
      .from("business_availability")
      .delete()
      .eq("business_id", business.id)
      .not("day_of_week", "is", null);
    if (deleteError) throw new AppError("INTERNAL", "Could not save your hours.", { cause: deleteError });
    const { error } = await supabase.from("business_availability").insert(
      open.map((day) => ({
        business_id: business.id,
        day_of_week: day.day,
        start_time: day.start,
        end_time: day.end,
        is_available: true,
      })),
    );
    if (error) throw new AppError("INTERNAL", "Could not save your hours.", { cause: error });
    next = businessNextPath(formData.get("next"));
  } catch (error) {
    return {
      ...toFormError(error, "We couldn't save your hours. Please try again."),
      values: formValues(formData),
    };
  }
  if (next) redirect(next);
  refreshPage();
  return saved("Working hours saved.");
}

export async function saveBookingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = bookingSettingsSchema.safeParse({
      acceptingBookings: formData.get("acceptingBookings") === "on",
      minNoticeHours: formData.get("minNoticeHours"),
      bookingWindowDays: formData.get("bookingWindowDays"),
      maxBookingsPerDay: formData.get("maxBookingsPerDay") ?? "",
    });
    if (!parsed.success)
      return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values: formValues(formData) };
    const supabase = await createClient();
    const { error } = await supabase
      .from("businesses")
      .update({
        accepting_bookings: parsed.data.acceptingBookings,
        min_notice_hours: parsed.data.minNoticeHours,
        booking_window_days: parsed.data.bookingWindowDays,
        max_bookings_per_day: parsed.data.maxBookingsPerDay ?? null,
      })
      .eq("id", business.id);
    if (error) throw new AppError("INTERNAL", "Could not save your booking settings.", { cause: error });
  } catch (error) {
    return {
      ...toFormError(error, "We couldn't save your booking settings. Please try again."),
      values: formValues(formData),
    };
  }
  refreshPage();
  return saved("Booking settings saved.");
}

export async function addDayOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = blockedDateSchema.safeParse({ date: formData.get("date") });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    if (parsed.data.date < lagosToday())
      return { status: "error", fieldErrors: { date: "Choose today or a future date." } };
    const supabase = await createClient();
    // Replace any existing override for that date.
    await supabase
      .from("business_availability")
      .delete()
      .eq("business_id", business.id)
      .eq("specific_date", parsed.data.date);
    const { error } = await supabase.from("business_availability").insert({
      business_id: business.id,
      specific_date: parsed.data.date,
      is_available: false,
    });
    if (error) throw new AppError("INTERNAL", "Could not add the day off.", { cause: error });
  } catch (error) {
    return toFormError(error, "We couldn't add that day off. Please try again.");
  }
  refreshPage();
  return saved("Day off added.");
}

export async function removeAvailabilityAction(availabilityId: string): Promise<void> {
  const { business } = await requireOwnBusinessForAction();
  if (!isId(availabilityId)) return;
  const supabase = await createClient();
  await supabase
    .from("business_availability")
    .delete()
    .eq("id", availabilityId)
    .eq("business_id", business.id)
    .not("specific_date", "is", null);
  refreshPage();
}

const isId = (value: unknown) => z.guid().safeParse(value).success;

/** Checks an uploaded file by its contents; a fake is deleted and logged. */
async function checkUpload(bucket: string, path: string, allowed: readonly SniffedType[]): Promise<boolean> {
  if (await verifyStoredFile(bucket, path, allowed)) return true;
  const user = await getSessionUser();
  await logSecurityEvent("upload.rejected", { userId: user?.id, details: { bucket } });
  return false;
}

// ---------------------------------------------------------------------------
// Portfolio, logo and cover. Files are uploaded by the browser straight to the business's
// folder in storage (storage policies only allow the owner); these record them.
// ---------------------------------------------------------------------------

export async function addPortfolioItemAction(input: {
  path: string;
  mediaType: "image" | "video";
  caption?: string;
}): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    const parsed = portfolioItemSchema.safeParse(input);
    if (!parsed.success || !isOwnStoragePath(business.id, parsed.data.path))
      return { status: "error", message: "That upload didn't work. Please try again." };
    const supabase = await createClient();
    const { count } = await supabase
      .from("business_portfolio")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id);
    if ((count ?? 0) >= 30)
      return { status: "error", message: "You can show up to 30 items. Remove one first." };
    if (
      !(await checkUpload(
        "business-media",
        parsed.data.path,
        parsed.data.mediaType === "image" ? IMAGE_TYPES : VIDEO_TYPES,
      ))
    )
      return {
        status: "error",
        message: "That file isn't a real photo or video. Photos: JPG, PNG or WebP. Videos: MP4, MOV or WebM.",
      };
    const { error } = await supabase.from("business_portfolio").insert({
      business_id: business.id,
      media_type: parsed.data.mediaType,
      storage_path: parsed.data.path,
      caption: parsed.data.caption ?? null,
      sort_order: count ?? 0,
    });
    if (error) throw new AppError("INTERNAL", "Could not add to your portfolio.", { cause: error });
  } catch (error) {
    return toFormError(error, "We couldn't add that to your portfolio. Please try again.");
  }
  refreshPage();
  return saved("Added to your portfolio.");
}

export async function removePortfolioItemAction(itemId: string): Promise<void> {
  const { business } = await requireOwnBusinessForAction();
  if (!isId(itemId)) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_portfolio")
    .delete()
    .eq("id", itemId)
    .eq("business_id", business.id)
    .select("storage_path");
  const paths = (data ?? []).map((row) => row.storage_path);
  if (paths.length > 0) await supabase.storage.from("business-media").remove(paths);
  refreshPage();
}

export async function setBusinessImageAction(kind: "logo" | "cover", path: string): Promise<FormState> {
  try {
    const { business } = await requireOwnBusinessForAction();
    if ((kind !== "logo" && kind !== "cover") || !isOwnStoragePath(business.id, path))
      return { status: "error", message: "That upload didn't work. Please try again." };
    if (!(await checkUpload("business-media", path, IMAGE_TYPES)))
      return { status: "error", message: "That file isn't a real photo. Use a JPG, PNG or WebP image." };
    const column = kind === "logo" ? "logo_path" : "cover_path";
    const previous = business[column];
    const supabase = await createClient();
    const { error } = await supabase
      .from("businesses")
      .update(kind === "logo" ? { logo_path: path } : { cover_path: path })
      .eq("id", business.id);
    if (error) throw new AppError("INTERNAL", "Could not save the image.", { cause: error });
    if (previous && previous !== path) await supabase.storage.from("business-media").remove([previous]);
  } catch (error) {
    return toFormError(error, "We couldn't save that image. Please try again.");
  }
  refreshPage();
  return saved(kind === "logo" ? "Logo updated." : "Cover photo updated.");
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export async function submitVerificationDocumentAction(input: {
  documentType: string;
  documentNumber?: string;
  notes?: string;
  path: string;
  requestId?: string;
}): Promise<FormState> {
  try {
    const { user, business } = await requireOwnBusinessForAction();
    const parsed = verificationDocumentSchema.safeParse(input);
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const doc = parsed.data;
    if (!isOwnStoragePath(business.id, doc.path))
      return { status: "error", message: "That upload didn't work. Please try again." };
    if (!(await checkUpload("verification-documents", doc.path, DOCUMENT_TYPES)))
      return {
        status: "error",
        message: "That file isn't a real PDF or photo. Upload a PDF, JPG, PNG or WebP.",
      };

    const supabase = await createClient();
    if (doc.requestId) {
      const { data: request } = await supabase
        .from("verification_requests")
        .select("id, status")
        .eq("id", doc.requestId)
        .eq("business_id", business.id)
        .maybeSingle();
      if (!request || request.status === "closed")
        throw new AppError("CONFLICT", "That request has been closed. Refresh to see the latest.");
    }

    const { error } = await supabase.from("business_verifications").insert({
      business_id: business.id,
      submitted_by: user.id,
      document_type: doc.documentType,
      document_number: doc.documentNumber ?? null,
      notes: doc.notes ?? null,
      document_path: doc.path,
      request_id: doc.requestId ?? null,
    });
    if (error) throw new AppError("INTERNAL", "Could not submit the document.", { cause: error });

    if (doc.requestId) {
      await createAdminClient()
        .from("verification_requests")
        .update({ status: "submitted" })
        .eq("id", doc.requestId)
        .eq("business_id", business.id)
        .eq("status", "open");
    }
  } catch (error) {
    return toFormError(error, "We couldn't submit that document. Please try again.");
  }
  refreshPage();
  return saved("Document submitted. We'll review it shortly.");
}

// ---------------------------------------------------------------------------
// Submit for review
// ---------------------------------------------------------------------------

export async function submitForReviewAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  try {
    const { user, business } = await requireOwnBusinessForAction();
    if (!canSubmitForReview(business.status))
      throw new AppError("CONFLICT", "Your business has already been submitted.");
    const missing = missingSteps(await getOnboardingProgress(business));
    if (missing.length > 0) {
      return { status: "error", message: `Finish these steps first: ${missing.join(", ")}.` };
    }
    // Status is never writable by owners; the database also checks the transition.
    const { data, error } = await createAdminClient()
      .from("businesses")
      .update({ status: "pending" })
      .eq("id", business.id)
      .eq("owner_id", user.id)
      .in("status", ["draft", "rejected"])
      .select("id");
    if (error) throw new AppError("INTERNAL", "Could not submit your business.", { cause: error });
    if (!data?.length) throw new AppError("CONFLICT", "Your business has already been submitted.");

    await notify({
      userId: user.id,
      type: "business.submitted",
      title: "Registration submitted",
      body: `${business.name} is waiting for review. We'll notify you when there's an update.`,
      data: { businessId: business.id },
    });
    // The Concierge team reviews every registration before it goes public.
    await notify(
      ...(await activeAdminIds()).map((adminId) => ({
        userId: adminId,
        type: "business.submitted",
        title: `New registration: ${business.name}`,
        body: "Waiting for review and verification.",
        data: { businessId: business.id },
      })),
    );
  } catch (error) {
    return toFormError(error, "We couldn't submit your business. Please try again.");
  }
  redirect("/business?submitted=1");
}
