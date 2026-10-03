"use server";

import { refreshPage } from "@/lib/utils/refresh";
import { z } from "zod";

import { recordAdminAction } from "@/lib/auth/admin-audit";
import { fieldErrorsFrom, type FormState } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { toFormError } from "@/lib/business/action-utils";
import { verificationDocumentTypes } from "@/lib/business/schemas";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { adminBusinessDecisions, type AdminBusinessDecision } from "./business-review";

const decisionSchema = z.object({
  businessId: z.guid(),
  reason: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || undefined),
});

const ownerMessages: Record<AdminBusinessDecision, { title: string; body: (name: string) => string }> = {
  start_review: { title: "Review started", body: (name) => `Our team is now reviewing ${name}.` },
  approve: {
    title: "You're approved",
    body: (name) => `${name} is live. Customers and the concierge can now find and book you.`,
  },
  reject: {
    title: "Registration not approved",
    body: (name) => `${name} wasn't approved. See the reason in your dashboard, update and resubmit.`,
  },
  suspend: {
    title: "Business suspended",
    body: (name) => `${name} is hidden from customers. Contact support to resolve this.`,
  },
  reinstate: { title: "Business reinstated", body: (name) => `${name} is live again.` },
};

/** Moves a business through review. Every decision is logged in the admin audit trail. */
export async function decideBusinessAction(
  decision: AdminBusinessDecision,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = decisionSchema.safeParse({
      businessId: formData.get("businessId"),
      reason: formData.get("reason") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const { businessId, reason } = parsed.data;
    if ((decision === "reject" || decision === "suspend") && !reason)
      return { status: "error", fieldErrors: { reason: "Give a reason. The business will see it." } };

    const db = createAdminClient();
    const { data: business } = await db
      .from("businesses")
      .select("id, name, status, owner_id")
      .eq("id", businessId)
      .maybeSingle();
    if (!business) throw new AppError("NOT_FOUND", "Business not found.");
    const rule = adminBusinessDecisions[decision];
    if (!rule.from.includes(business.status))
      throw new AppError("CONFLICT", "This business changed. Refresh to see the latest.");

    const { data, error } = await db
      .from("businesses")
      .update({ status: rule.to, status_reason: reason ?? null })
      .eq("id", business.id)
      .eq("status", business.status)
      .select("id");
    if (error) throw new AppError("INTERNAL", "Could not update the business.", { cause: error });
    if (!data?.length) throw new AppError("CONFLICT", "This business changed. Refresh to see the latest.");

    await recordAdminAction(admin, {
      action: `business.${decision}`,
      targetType: "businesses",
      targetId: business.id,
      reason,
      metadata: { from: business.status, to: rule.to },
    });
    const message = ownerMessages[decision];
    await notify({
      userId: business.owner_id,
      type: `business.${decision}`,
      title: message.title,
      body: message.body(business.name),
      data: { businessId: business.id },
    });
  } catch (error) {
    return toFormError(error, "We couldn't update this business. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Business updated." };
}

const requestSchema = z.object({
  businessId: z.guid(),
  documentType: z
    .enum(verificationDocumentTypes)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  message: z.string().trim().min(5, "Say what you need from the business.").max(1000),
});

/** Ask a business for specific verification information. Moves a pending registration into review. */
export async function requestVerificationInfoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = requestSchema.safeParse({
      businessId: formData.get("businessId"),
      documentType: formData.get("documentType") ?? "",
      message: formData.get("message"),
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    const input = parsed.data;

    const db = createAdminClient();
    const { data: business } = await db
      .from("businesses")
      .select("id, name, status, owner_id")
      .eq("id", input.businessId)
      .maybeSingle();
    if (!business) throw new AppError("NOT_FOUND", "Business not found.");

    const { data: request, error } = await db
      .from("verification_requests")
      .insert({
        business_id: business.id,
        requested_by: admin.id,
        document_type: input.documentType ?? null,
        message: input.message,
      })
      .select("id")
      .single();
    if (error) throw new AppError("INTERNAL", "Could not send the request.", { cause: error });
    if (business.status === "pending") {
      await db
        .from("businesses")
        .update({ status: "under_review" })
        .eq("id", business.id)
        .eq("status", "pending");
    }

    await recordAdminAction(admin, {
      action: "business.request_verification",
      targetType: "businesses",
      targetId: business.id,
      reason: input.message,
      metadata: { requestId: request.id, documentType: input.documentType ?? null },
    });
    await notify({
      userId: business.owner_id,
      type: "business.verification_requested",
      title: "We need more information",
      body: input.message,
      data: { businessId: business.id, requestId: request.id },
    });
  } catch (error) {
    return toFormError(error, "We couldn't send the request. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Request sent to the business." };
}

const documentDecisionSchema = z.object({
  verificationId: z.guid(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || undefined),
});

/** Accept or reject one verification document. Accepting a document closes the request it answered. */
export async function reviewDocumentAction(
  decision: "approved" | "rejected",
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const admin = await requireRole("admin");
    const parsed = documentDecisionSchema.safeParse({
      verificationId: formData.get("verificationId"),
      notes: formData.get("notes") ?? undefined,
    });
    if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };
    if (decision === "rejected" && !parsed.data.notes)
      return { status: "error", fieldErrors: { notes: "Say why, so the business can fix it." } };

    const db = createAdminClient();
    const { data: doc, error } = await db
      .from("business_verifications")
      .update({
        status: decision,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString(),
        review_notes: parsed.data.notes ?? null,
      })
      .eq("id", parsed.data.verificationId)
      .eq("status", "pending")
      .select("id, business_id, request_id, businesses(owner_id)")
      .maybeSingle();
    if (error) throw new AppError("INTERNAL", "Could not save the decision.", { cause: error });
    if (!doc) throw new AppError("CONFLICT", "This document was already reviewed.");

    if (doc.request_id && decision === "approved") {
      await db
        .from("verification_requests")
        .update({ status: "closed", resolved_at: new Date().toISOString() })
        .eq("id", doc.request_id);
    } else if (doc.request_id) {
      // Rejected: the request stays open for a better document.
      await db.from("verification_requests").update({ status: "open" }).eq("id", doc.request_id);
    }

    await recordAdminAction(admin, {
      action: `verification.${decision === "approved" ? "approve" : "reject"}`,
      targetType: "business_verifications",
      targetId: doc.id,
      reason: parsed.data.notes,
    });
    if (doc.businesses?.owner_id) {
      await notify({
        userId: doc.businesses.owner_id,
        type: `verification.${decision}`,
        title: decision === "approved" ? "Document accepted" : "Document not accepted",
        body: parsed.data.notes,
        data: { businessId: doc.business_id },
      });
    }
  } catch (error) {
    return toFormError(error, "We couldn't save that decision. Please try again.");
  }
  refreshPage();
  return { status: "success", message: "Saved." };
}
