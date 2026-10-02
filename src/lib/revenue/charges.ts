import "server-only";

import { randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors";
import { notify } from "@/lib/notifications";
import type { PaymentProviderName } from "@/lib/env/schema";
import { getPaymentProvider } from "@/lib/payments";
import { logSecurityEvent } from "@/lib/security/events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export function newChargeReference(): string {
  return `CHG-${randomBytes(8).toString("hex").toUpperCase()}`;
}

export type ChargeKind = "subscription" | "featured";

/**
 * Starts a business's payment for a plan or featured placement and returns the provider's checkout
 * URL. The database sets the price from the catalogue and checks the payer owns the approved
 * business, so nothing about the amount comes from the browser.
 */
export async function startCharge(
  kind: ChargeKind,
  itemCode: string,
  business: { id: string },
  payer: { id: string; email: string },
): Promise<string> {
  const provider = getPaymentProvider();
  const admin = createAdminClient();
  const reference = newChargeReference();

  const { data: charge, error } = await admin
    .from("business_charges")
    .insert({
      business_id: business.id,
      payer_id: payer.id,
      kind,
      item_code: itemCode,
      reference,
      provider: provider.name,
      amount_minor: 1, // replaced by the catalogue price in the database
    })
    .select("amount_minor")
    .single();
  if (error || !charge) {
    if (error?.code === "23514")
      throw new AppError("VALIDATION_FAILED", "That option isn’t available right now.");
    throw new AppError("INTERNAL", "Could not start payment.", { cause: error });
  }

  try {
    const { authorizationUrl } = await provider.initialize({
      reference,
      amount: { amountMinor: charge.amount_minor, currency: "NGN" },
      customerEmail: payer.email,
      callbackUrl: `${getServerEnv().NEXT_PUBLIC_APP_URL}/api/payments/callback`,
      metadata: { businessId: business.id, kind, item: itemCode },
    });
    return authorizationUrl;
  } catch (cause) {
    await admin
      .from("business_charges")
      .update({ status: "failed", failure_reason: "Checkout could not be started" })
      .eq("reference", reference)
      .eq("status", "pending");
    throw cause;
  }
}

/**
 * Verifies a business's payment with its provider, server to server, then records it and switches
 * on the plan or placement in one database step. Safe to call more than once (callback and webhook).
 */
export async function finalizeCharge(
  reference: string,
  source: "callback" | "webhook" = "callback",
  expectedProvider?: string,
): Promise<{ kind: ChargeKind; paid: boolean }> {
  const admin = createAdminClient();
  const { data: charge } = await admin
    .from("business_charges")
    .select("id, business_id, payer_id, kind, item_code, provider, amount_minor, status")
    .eq("reference", reference)
    .maybeSingle();
  if (!charge || (expectedProvider && charge.provider !== expectedProvider))
    throw new AppError("NOT_FOUND", "Payment not found.");
  const kind = charge.kind as ChargeKind;
  if (charge.status === "success") return { kind, paid: true };

  const result = await getPaymentProvider(charge.provider as PaymentProviderName).verify(reference);
  const paid =
    result.status === "success" &&
    result.amount.currency === "NGN" &&
    result.amount.amountMinor === charge.amount_minor;
  const evidence = {
    verifiedVia: source,
    verifiedAt: new Date().toISOString(),
    providerStatus: result.status,
    providerAmountMinor: result.amount.amountMinor,
  } satisfies Json;

  if (!paid) {
    if (result.status === "pending") return { kind, paid: false };
    if (result.status === "success")
      await logSecurityEvent("payment.mismatch", {
        userId: charge.payer_id,
        details: {
          reference,
          expectedMinor: charge.amount_minor,
          paidMinor: result.amount.amountMinor,
          currency: result.amount.currency,
        },
      });
    await admin
      .from("business_charges")
      .update({
        status: "failed",
        failure_reason:
          result.status === "success" ? "Amount or currency didn't match the price" : "Not completed",
        provider_reference: result.providerReference,
        provider_payload: evidence,
      })
      .eq("id", charge.id)
      .eq("status", "pending");
    return { kind, paid: false };
  }

  const { data, error } = await admin.rpc("complete_business_charge", {
    p_reference: reference,
    p_paid_at: (result.paidAt ?? new Date()).toISOString(),
    p_provider_reference: result.providerReference ?? "",
    p_channel: result.channel ?? "",
    p_payload: evidence,
  });
  if (error) throw new AppError("INTERNAL", "Could not record the payment.", { cause: error });

  const activated = (data as { activated?: boolean } | null)?.activated === true;
  if (activated) {
    await notify({
      userId: charge.payer_id,
      type: kind === "subscription" ? "billing.plan_started" : "billing.featured_started",
      title: kind === "subscription" ? "Your plan is active" : "Your business is featured",
      body:
        kind === "subscription"
          ? "Thanks for your payment. Your new plan is active."
          : "Thanks for your payment. You'll be shown first when you meet everything a customer asks for.",
      data: { businessId: charge.business_id },
    });
  }
  return { kind, paid: true };
}
