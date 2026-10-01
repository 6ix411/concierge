import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getServerEnv } from "@/lib/env/server";
import { logger } from "@/lib/errors";
import { dispatchDeliveries } from "@/lib/notifications/channels";

export const dynamic = "force-dynamic";

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Sends notifications queued for email, SMS or push. Called by a scheduler with
 * "Authorization: Bearer <CRON_SECRET>". Off (404) until CRON_SECRET is set.
 */
export async function POST(request: NextRequest) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 404 });
  if (!authorised(request.headers.get("authorization"), secret))
    return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await dispatchDeliveries()) });
  } catch (error) {
    logger.error("Notification dispatch failed", { error });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
