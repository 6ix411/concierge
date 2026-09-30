import Link from "next/link";

import { Container } from "@/components/layout/container";

export default function NotFound() {
  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted">The page you’re looking for doesn’t exist or has moved.</p>
      <Link href="/" className="font-medium underline underline-offset-4">
        Back to home
      </Link>
    </Container>
  );
}
