import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

export type SessionUpdate = {
  response: NextResponse;
  userId: string | null;
  /** Looks up the signed-in user's role (null when signed out, suspended or unknown). */
  getActiveRole: () => Promise<Database["public"]["Enums"]["user_role"] | null>;
};

/** Refreshes the Supabase auth session on every matched request and forwards updated cookies. */
export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without Supabase configured (e.g. first local run) the site still renders.
  if (!url || !anonKey) return { response, userId: null, getActiveRole: async () => null };

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it revalidates the session.
  const { data } = await supabase.auth.getClaims();

  const userId = data?.claims.sub ?? null;

  return {
    response,
    userId,
    getActiveRole: async () => {
      if (!userId) return null;
      const { data: row } = await supabase
        .from("users")
        .select("role, status")
        .eq("id", userId)
        .maybeSingle();
      return row?.status === "active" ? row.role : null;
    },
  };
}
