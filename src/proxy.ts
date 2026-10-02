import { NextResponse, type NextRequest } from "next/server";

import { isInternalAdminPath, toInternalAdminPath } from "@/lib/auth/admin-path";
import { areaForPath, canAccessArea, homePathForRole } from "@/lib/auth/permissions";
import { contentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Refreshes the session and routes protected areas.
 * This is a fast first check that gives clean redirects. Every protected layout, page, action and
 * route handler verifies the user and role again on the server (src/lib/auth/session.ts), and the
 * database enforces row level security on top.
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV === "development",
  );
  // Next.js reads the policy from the request to put the nonce on its own scripts.
  const { response, userId, getActiveRole } = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": csp,
  });
  response.headers.set("Content-Security-Policy", csp);
  const { pathname, search } = request.nextUrl;

  const withSessionCookies = (next: NextResponse) => {
    for (const cookie of response.cookies.getAll()) next.cookies.set(cookie);
    next.headers.set("Content-Security-Policy", csp);
    return next;
  };
  const redirectTo = (path: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = query;
    return withSessionCookies(NextResponse.redirect(url));
  };
  // Renders the regular 404 page, identical to any unknown URL.
  const notFound = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/_not-found";
    url.search = "";
    return withSessionCookies(NextResponse.rewrite(url, { status: 404 }));
  };

  // The internal admin route is never reachable directly.
  if (isInternalAdminPath(pathname)) return notFound();

  const area = areaForPath(pathname);
  if (!area) return response;

  if (area === "admin") {
    // Anyone who isn't a signed-in, active admin sees a plain 404 at the private URL.
    const role = userId ? await getActiveRole() : null;
    const internal = toInternalAdminPath(pathname);
    if (role !== "admin" || !internal) return notFound();

    const url = request.nextUrl.clone();
    url.pathname = internal;
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    const rewrite = withSessionCookies(NextResponse.rewrite(url, { request: { headers } }));
    rewrite.headers.set("X-Robots-Tag", "noindex, nofollow");
    rewrite.headers.set("Cache-Control", "private, no-store");
    return rewrite;
  }

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
