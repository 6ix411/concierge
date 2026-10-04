import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { getPublicEnv } from "@/lib/env/client";
import type { Database } from "@/types/database";

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * The access token a mobile app sent as "Authorization: Bearer <token>" (the same Supabase session
 * token the website keeps in a cookie). Only JWT-shaped values count, so other bearer secrets
 * (the notification job's CRON_SECRET) are ignored.
 */
export async function bearerToken(): Promise<string | null> {
  const value = (await headers())
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1]
    ?.trim();
  return value && JWT.test(value) ? value : null;
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, acting as the signed-in
 * user: from the session cookie on the website, or from the bearer token on the mobile API. Either
 * way the database applies the same row level security to that user.
 */
export async function createClient() {
  const env = getPublicEnv();
  const token = await bearerToken();
  if (token) {
    return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
