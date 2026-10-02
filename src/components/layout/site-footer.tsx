import Link from "next/link";

import { Container } from "./container";

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-6 text-sm text-muted">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} Concierge by 6IX</span>
        <Link href="/become-a-provider" className="py-2 font-medium hover:text-foreground hover:underline">
          Become a Provider
        </Link>
      </Container>
    </footer>
  );
}
