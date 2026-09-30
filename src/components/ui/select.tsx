import { useId, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export function Select({
  label,
  className,
  children,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={selectId}
        className={cn(
          "h-11 rounded-xl border border-border bg-surface px-3 text-base sm:text-sm",
          "focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
