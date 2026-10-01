import { Search } from "lucide-react";
import type { ReactNode } from "react";

/** A GET search box: the query lives in the URL, so results can be shared and bookmarked. */
export function SearchForm({
  action,
  defaultValue,
  label,
  placeholder = "Search",
  children,
}: {
  action: string;
  defaultValue: string;
  label: string;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <form action={action} role="search" className="flex max-w-md gap-2">
      {children}
      <label className="relative flex-1">
        <span className="sr-only">{label}</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
        />
      </label>
      <button
        type="submit"
        className="h-10 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
      >
        Search
      </button>
    </form>
  );
}
