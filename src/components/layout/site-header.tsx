import Link from "next/link";

import { Container } from "./container";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <Container className="flex h-14 items-center justify-between">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Concierge <span className="font-normal text-muted">by 6IX</span>
        </Link>
      </Container>
    </header>
  );
}
