import type { Instrumentation } from "next";

import { logger } from "@/lib/errors";

/**
 * Runs once when a server starts. In production the server checks its settings straight away, so a
 * deployment with a missing or unsafe value fails at once instead of on some customer's request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.APP_ENV !== "production") return;
  const { getServerEnv } = await import("@/lib/env/server");
  try {
    getServerEnv();
  } catch (error) {
    logger.error("Server settings are invalid", { error });
    throw error;
  }
}

/**
 * Every unhandled server error (pages, route handlers, server actions, proxy) becomes one JSON line
 * with "level":"error", which the log drain forwards to monitoring (docs/deployment.md). The path
 * is logged without its query string, and no headers, so tokens and personal details stay out.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  logger.error("Unhandled server error", {
    error,
    digest:
      typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
  });
};
