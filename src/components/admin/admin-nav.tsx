"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const links = [
  { path: "", label: "Overview" },
  { path: "/businesses", label: "Providers" },
  { path: "/bookings", label: "Bookings" },
  { path: "/payments", label: "Payments" },
  { path: "/payouts", label: "Payouts" },
  { path: "/disputes", label: "Disputes" },
  { path: "/reports", label: "Chat reports" },
  { path: "/reviews", label: "Reviews" },
  { path: "/users", label: "Users" },
  { path: "/categories", label: "Categories" },
  { path: "/revenue", label: "Revenue" },
  { path: "/commission", label: "Commission" },
  { path: "/audit", label: "Audit log" },
  { path: "/security", label: "Security" },
  { path: "/notifications", label: "Notifications" },
];

/** `base` is the private admin path. The browser may show it or the internal /admin path. */
export function AdminNav({ base }: { base: string }) {
  const pathname = usePathname();
  const prefix = pathname.startsWith(base) ? base : "/admin";
  const current = pathname.slice(prefix.length) || "";
  return (
    <nav aria-label="Admin" className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4">
      <ul className="flex gap-1">
        {links.map((link) => {
          const active = link.path === "" ? current === "" : current.startsWith(link.path);
          return (
            <li key={link.path}>
              <Link
                href={`${base}${link.path}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                  active ? "bg-brand text-brand-foreground" : "text-muted hover:bg-surface-muted",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
