import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";

import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "You’re offline", robots: { index: false } };

/**
 * Shown by the installed app (service worker, public/sw.js) when a page can't load because the
 * phone has no connection. It is cached signed out, so it never holds anyone's details.
 */
export default function OfflinePage() {
  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">You’re offline</h1>
      <p className="text-muted">
        Concierge needs a connection to search providers, book and chat. Check your data or Wi-Fi and try
        again.
      </p>
      <div className="flex items-center gap-4">
        <RetryButton />
        <Link href="/" className="font-medium underline underline-offset-4">
          Home
        </Link>
      </div>
    </Container>
  );
}
