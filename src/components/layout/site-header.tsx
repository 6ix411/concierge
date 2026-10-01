import { User } from "lucide-react";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { homePathForRole } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

import { Container } from "./container";

const navLink = "hover:bg-surface-muted rounded-xl px-3 py-2 font-medium";

export async function SiteHeader() {
  const user = await getSessionUser().catch(() => null);
  const isCustomerSide = !user || user.role === "customer";

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <Container className="flex h-14 items-center justify-between gap-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Concierge <span className="font-normal text-muted">by 6IX</span>
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1 text-sm">
          {isCustomerSide && (
            <span className="hidden items-center gap-1 md:flex">
              <Link href="/concierge" className={navLink}>
                Concierge
              </Link>
              <Link href="/services" className={navLink}>
                Services
              </Link>
            </span>
          )}
          {user ? (
            <>
              {user.role === "customer" && (
                <span className="hidden items-center gap-1 md:flex">
                  <Link href="/account/bookings" className={navLink}>
                    Bookings
                  </Link>
                  <Link href="/account/messages" className={navLink}>
                    Messages
                  </Link>
                </span>
              )}
              {/* No link to the admin dashboard anywhere on the site: admins use their private URL. */}
              {user.role !== "admin" && (
                <Link
                  href={user.role === "customer" ? "/account" : homePathForRole(user.role)}
                  className={navLink}
                  aria-label={user.role === "business" ? "Dashboard" : "My account"}
                >
                  {user.role === "business" ? (
                    "Dashboard"
                  ) : (
                    <>
                      <User aria-hidden className="size-5 md:hidden" />
                      <span className="hidden md:inline">Account</span>
                    </>
                  )}
                </Link>
              )}
              {user.role !== "customer" && <SignOutButton />}
            </>
          ) : (
            <>
              <Link href="/become-a-provider" className={`${navLink} hidden md:inline-block`}>
                Become a Provider
              </Link>
              <Link href="/sign-in" className={navLink}>
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
