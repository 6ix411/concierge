import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env/client";
import type { Database } from "@/types/database";

/**
 * A client with no session: it reads exactly what any visitor to the site can read, under row level
 * security. Used where code must not see more than public data, whoever is signed in (the AI
 * Concierge's tools).
 */
export function createPublicClient() {
  const env = getPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
