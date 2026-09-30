import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { homePathForRole } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

import { Container } from "./container";

export async function SiteHeader() {
  const user = await getSessionUser().catch(() => null);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <Container className="flex h-14 items-center justify-between gap-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Concierge <span className="font-normal text-muted">by 6IX</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              {/* No link to the admin dashboard anywhere on the site: admins use their private URL. */}
              {user.role !== "admin" && (
                <Link
                  href={homePathForRole(user.role)}
                  className="rounded-xl px-3 py-2 font-medium hover:bg-surface-muted"
                >
                  {user.role === "business" ? "Dashboard" : "My account"}
                </Link>
              )}
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="rounded-xl px-3 py-2 font-medium hover:bg-surface-muted">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-xl bg-brand px-3 py-2 font-medium text-brand-foreground"
              >
                Join
              </Link>
            </>
          )}
        </nav>
      </Container>
    </header>
  );
}
