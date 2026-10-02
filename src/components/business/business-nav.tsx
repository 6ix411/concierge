"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const links = [
  { href: "/business", label: "Overview", exact: true },
  { href: "/business/profile", label: "Profile" },
  { href: "/business/services", label: "Services" },
  { href: "/business/availability", label: "Availability" },
  { href: "/business/bookings", label: "Bookings" },
  { href: "/business/messages", label: "Messages" },
  { href: "/business/earnings", label: "Earnings" },
  { href: "/business/reviews", label: "Reviews" },
  { href: "/business/plan", label: "Plan" },
  { href: "/business/promote", label: "Get featured" },
  { href: "/business/verification", label: "Verification" },
];

export function BusinessNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/business/setup")) return null;
  return (
    <nav aria-label="Business dashboard" className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4">
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
