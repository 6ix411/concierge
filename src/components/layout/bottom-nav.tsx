"use client";

import { CalendarDays, Home, MessageCircle, Search, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const items: { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }[] = [
  { href: "/", label: "Home", icon: Home, match: (p) => p === "/" },
  { href: "/concierge", label: "Concierge", icon: Sparkles, match: (p) => p.startsWith("/concierge") },
  {
    href: "/search",
    label: "Explore",
    icon: Search,
    match: (p) => ["/search", "/services", "/businesses", "/compare"].some((prefix) => p.startsWith(prefix)),
  },
  {
    href: "/account/bookings",
    label: "Bookings",
    icon: CalendarDays,
    match: (p) => p.startsWith("/account/bookings"),
  },
  {
    href: "/account/messages",
    label: "Messages",
    icon: MessageCircle,
    match: (p) => p.startsWith("/account/messages"),
  },
];

/** Mobile tab bar for customers and visitors. Hidden on larger screens, where the header has these links. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {items.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted",
                )}
              >
                <Icon aria-hidden className={cn("size-5", active && "stroke-[2.5]")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
