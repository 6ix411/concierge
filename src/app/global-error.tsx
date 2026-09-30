"use client";

import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        {error.digest && <p className="text-sm text-muted">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={() => retry()}
          className="h-11 rounded-xl bg-brand px-4 text-sm font-medium text-brand-foreground"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
