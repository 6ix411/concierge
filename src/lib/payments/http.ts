import "server-only";

import { AppError, logger } from "@/lib/errors";

export type Fetch = typeof fetch;

/**
 * Calls a payment provider's JSON API with the secret key. Errors never include the key, and the
 * provider's message is logged rather than shown to customers.
 */
export async function callProvider<T>(
  fetchImpl: Fetch,
  provider: string,
  url: string,
  secretKey: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new AppError("INTERNAL", `${provider} could not be reached.`, { cause: error });
  }
  const json = (await response.json().catch(() => null)) as T & { message?: string };
  if (!response.ok || json === null) {
    logger.error(`${provider} request failed`, { url, status: response.status, message: json?.message });
    throw new AppError("INTERNAL", `${provider} returned an error: ${json?.message ?? response.status}`);
  }
  return json;
}

/** Naira with kobo, for providers that take decimal amounts (Flutterwave). */
export const toNaira = (amountMinor: number) => Math.round(amountMinor) / 100;
/** Kobo from a decimal naira amount, without float drift. */
export const toKobo = (naira: number) => Math.round(naira * 100);
