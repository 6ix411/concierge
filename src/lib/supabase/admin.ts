import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env/server";
import type { Database } from "@/types/database";

/**
 * Service-role client. BYPASSES Row Level Security.
 * Only for trusted server code (webhooks, admin jobs) after the caller has been authorized.
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
