/**
 * The Content Security Policy for every page. Scripts only run from this site and only with the
 * per-request nonce Next.js adds to its own scripts, so injected markup can't run code. The page
 * talks only to this site and Supabase, can't be framed, and forms only post back here.
 */
export function contentSecurityPolicy(
  nonce: string,
  supabaseUrl: string | undefined,
  isDev: boolean,
): string {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const realtime = supabase.replace(/^http/, "ws");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by components; styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    `media-src 'self' blob: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${realtime}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when the site itself is on HTTPS (a local build talks to Supabase over plain HTTP).
    ...(!isDev && supabase.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ").replace(/\s{2,}/g, " ");
}

export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
