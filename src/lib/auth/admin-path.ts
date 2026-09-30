/**
 * The admin dashboard lives at a private URL set by ADMIN_PATH (server-only).
 * Internally the pages are under /admin, but that path always returns 404; the proxy
 * rewrites the private path to it for signed-in admins only. Everyone else gets a 404
 * at both URLs, so the site never reveals that an admin area exists.
 */

export const INTERNAL_ADMIN_PATH = "/admin";

/** A private slug must be long and unguessable. Generate one with: openssl rand -hex 16 */
export const adminSlugPattern = /^[A-Za-z0-9_-]{16,64}$/;

/** The private admin base path (e.g. "/9f2c…"), or null when not configured (admin disabled). */
export function getAdminPath(): string | null {
  const slug = process.env.ADMIN_PATH?.trim().replace(/^\/+|\/+$/g, "");
  if (!slug || !adminSlugPattern.test(slug)) return null;
  return `/${slug}`;
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isInternalAdminPath(pathname: string): boolean {
  return isUnder(pathname, INTERNAL_ADMIN_PATH);
}

/** Maps the private URL to the internal route, e.g. /<slug>/businesses → /admin/businesses. */
export function toInternalAdminPath(pathname: string): string | null {
  const base = getAdminPath();
  if (!base || !isUnder(pathname, base)) return null;
  return INTERNAL_ADMIN_PATH + pathname.slice(base.length);
}

/** Builds a link inside the admin dashboard, e.g. adminHref("/businesses"). Server-side only. */
export function adminHref(subpath = ""): string {
  const base = getAdminPath();
  if (!base) return "/";
  return subpath ? `${base}/${subpath.replace(/^\/+/, "")}` : base;
}
