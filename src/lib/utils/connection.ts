/** Shown when a request never reached the server (no signal, dropped connection, server unreachable). */
export const CONNECTION_MESSAGE =
  "We couldn’t reach Concierge. Check your connection and try again. Nothing was sent.";

/**
 * True for errors that mean the request didn't get through, as browsers report them: Chrome
 * "Failed to fetch", Safari "Load failed", Firefox "NetworkError when attempting to fetch resource".
 */
export function isConnectionError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!(error instanceof Error)) return false;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(error.message);
}
