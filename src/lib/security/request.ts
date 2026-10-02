import "server-only";

import { createHmac } from "node:crypto";

import { headers } from "next/headers";

import { getServerEnv } from "@/lib/env/server";

/** The caller's network address as reported by the hosting proxy, or "unknown". */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    // Outside a request (scheduled jobs).
    return "unknown";
  }
}

/** A keyed hash of a network address, so logs can link events without storing the address. */
export function hashIp(ip: string): string {
  return createHmac("sha256", getServerEnv().SUPABASE_SERVICE_ROLE_KEY).update(ip).digest("hex").slice(0, 32);
}
