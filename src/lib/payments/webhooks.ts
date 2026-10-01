import "server-only";

import { createHash } from "node:crypto";

import type { PaymentProviderName } from "@/lib/env/schema";
import { isAppError, logger } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { finalizePayment } from "./checkout";
import { refreshPayoutByReference } from "./payouts";
import { completeRefund } from "./refunds";
import type { PaymentProvider, WebhookEvent } from "./types";

export type WebhookOutcome = { status: number; body: { received: boolean; note?: string } };

/**
 * Handles a webhook whose provider is known. The signature is checked against the raw body first;
 * then the event is stored (once per body) and acted on. Payments and transfers are always re-checked
 * with the provider before anything changes, so the webhook body itself is never trusted.
 */
export async function handleWebhook(
  provider: PaymentProvider,
  rawBody: string,
  headers: Headers,
): Promise<WebhookOutcome> {
  const valid = await provider.verifyWebhookSignature(rawBody, headers).catch(() => false);
  if (!valid) return { status: 401, body: { received: false } };

  let event: WebhookEvent;
  let payload: NonNullable<Json>;
  try {
    event = provider.parseWebhook(rawBody);
    payload = (JSON.parse(rawBody) as Json) ?? {};
  } catch {
    return { status: 400, body: { received: false } };
  }

  const db = createAdminClient();
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const { data: stored, error } = await db
    .from("payment_webhook_events")
    .insert({
      provider: provider.name,
      event: event.event,
      reference: event.reference,
      body_hash: bodyHash,
      payload,
    })
    .select("id")
    .single();
  let id = stored?.id;
  if (error) {
    // 23505: we've had this exact webhook before. Providers retry; handle it again only if it failed.
    if (error.code !== "23505") throw error;
    const { data: earlier } = await db
      .from("payment_webhook_events")
      .select("id, processed_at")
      .eq("provider", provider.name)
      .eq("body_hash", bodyHash)
      .single();
    if (earlier?.processed_at) return { status: 200, body: { received: true, note: "duplicate" } };
    id = earlier?.id;
  }

  try {
    const note = await applyWebhookEvent(provider.name, event);
    await db
      .from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: note ?? null })
      .eq("id", id!);
    return { status: 200, body: { received: true, note } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logger.error("Payment webhook failed", {
      provider: provider.name,
      event: event.event,
      reference: event.reference,
      error: cause,
    });
    await db
      .from("payment_webhook_events")
      .update({ error: message.slice(0, 500) })
      .eq("id", id!);
    // A 5xx makes the provider retry later.
    return { status: 500, body: { received: false } };
  }
}

/** Returns a note when the event was deliberately not acted on. */
async function applyWebhookEvent(
  provider: PaymentProviderName,
  event: WebhookEvent,
): Promise<string | undefined> {
  try {
    switch (event.kind) {
      case "charge": {
        const { paid } = await finalizePayment(event.reference, "webhook", provider);
        return paid ? undefined : "not paid";
      }
      case "transfer":
        await refreshPayoutByReference(event.reference);
        return undefined;
      case "refund":
        await completeRefund(event.reference, event.status);
        return undefined;
      case "ignored":
        return "ignored";
    }
  } catch (error) {
    // Not one of ours (the provider account may serve other apps): acknowledge so it isn't retried.
    if (isAppError(error) && error.code === "NOT_FOUND") return "unknown reference";
    throw error;
  }
}
