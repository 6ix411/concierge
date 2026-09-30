import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function FormMessage({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-3 py-2 text-sm",
        tone === "error" ? "bg-danger/10 text-danger" : "bg-verified/10 text-verified",
      )}
    >
      {children}
    </p>
  );
}
