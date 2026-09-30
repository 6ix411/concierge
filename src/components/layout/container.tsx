import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-5xl px-4 sm:px-6", className)} {...props} />;
}
