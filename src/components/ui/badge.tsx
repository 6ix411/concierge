import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

const tones = {
  neutral: "bg-surface-muted text-muted",
  verified: "bg-verified/10 text-verified",
  accent: "bg-accent/15 text-accent",
  danger: "bg-danger/10 text-danger",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
