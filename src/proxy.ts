import { NextResponse, type NextRequest } from "next/server";

import { areaForPath, canAccessArea, homePathForRole } from "@/lib/auth/permissions";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Refreshes the session and sends signed-out visitors away from protected areas.
 * This is a fast first check that gives clean redirects. Every protected layout, page, action and route handler
 * verifies the user and role again on the server (src/lib/auth/session.ts), and the
 * database enforces row level security on top.
 */
export async function proxy(request: NextRequest) {
  const { response, userId, getActiveRole } = await updateSession(request);
  const { pathname, search } = request.nextUrl;
  const area = areaForPath(pathname);
  if (!area) return response;

  const redirectTo = (path: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = query;
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!userId) return redirectTo("/sign-in", `?next=${encodeURIComponent(pathname + search)}`);

  const role = await getActiveRole();
  if (!role) return redirectTo("/account-suspended");
  if (!canAccessArea(role, area)) return redirectTo(homePathForRole(role));

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
