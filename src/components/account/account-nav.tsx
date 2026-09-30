"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const links = [
  { href: "/account", label: "Overview", exact: true },
  { href: "/account/bookings", label: "Bookings" },
  { href: "/account/messages", label: "Messages" },
  { href: "/account/reviews", label: "Reviews" },
  { href: "/account/settings", label: "Settings" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4">
      <ul className="flex gap-1">
        {links.map((link) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
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
