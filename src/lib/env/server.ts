import "server-only";

import { parseEnv, serverEnvSchema, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Validation is lazy so `next build` does not
 * need production secrets; the first request that needs them fails loudly instead.
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseEnv(serverEnvSchema, process.env, "server");
  return cached;
}
