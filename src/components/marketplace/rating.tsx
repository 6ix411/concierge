import { Star } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export function Rating({ value, count, className }: { value: number; count: number; className?: string }) {
  if (count === 0) return <span className={cn("text-sm text-muted", className)}>New</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Star aria-hidden className="size-4 fill-accent text-accent" />
      <span className="font-medium">{Number(value).toFixed(1)}</span>
      <span className="text-muted">({count})</span>
      <span className="sr-only">
        Rated {Number(value).toFixed(1)} out of 5 from {count} reviews
      </span>
    </span>
  );
}

export function Stars({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            size === "sm" ? "size-4" : "size-5",
            n <= value ? "fill-accent text-accent" : "text-border",
          )}
        />
      ))}
    </span>
  );
}
