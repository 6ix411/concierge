import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { BottomNav } from "@/components/layout/bottom-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSessionUser } from "@/lib/auth/session";
import { SiteHeader } from "@/components/layout/site-header";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Concierge by 6IX", template: "%s · Concierge by 6IX" },
  description: "Tell our concierge what you need and get matched with verified businesses.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1015" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser().catch(() => null);
  const showBottomNav = !user || user.role === "customer";
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className={`flex min-h-full flex-col font-sans ${showBottomNav ? "pb-16 md:pb-0" : ""}`}>
        <SiteHeader />
        <main className="flex flex-1 flex-col">{children}</main>
        <SiteFooter />
        {showBottomNav && <BottomNav />}
      </body>
    </html>
  );
}
