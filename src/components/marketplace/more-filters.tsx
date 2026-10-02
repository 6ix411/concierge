"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * On phones the extra search filters fold away behind one button, so results start on the first
 * screen. Larger screens always show them.
 */
export function MoreFilters({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="more-filters"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium sm:col-span-2 md:hidden"
      >
        <SlidersHorizontal aria-hidden className="size-4" />
        {open ? "Fewer filters" : "More filters"}
        {active > 0 && (
          <span className="rounded-full bg-foreground px-1.5 text-xs text-background tabular-nums">
            {active}
          </span>
        )}
      </button>
      <div id="more-filters" className={cn("contents", !open && "max-md:hidden")}>
        {children}
      </div>
    </>
  );
}
