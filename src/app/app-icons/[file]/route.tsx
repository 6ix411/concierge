import { notFound } from "next/navigation";

import { appIcon } from "@/lib/pwa/icon";

/** Home-screen icons listed in the web app manifest. Built once at build time. */
const icons: Record<string, { size: number; maskable?: boolean }> = {
  "icon-192.png": { size: 192 },
  "icon-512.png": { size: 512 },
  "maskable-512.png": { size: 512, maskable: true },
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(icons).map((file) => ({ file }));
}

export async function GET(_request: Request, ctx: RouteContext<"/app-icons/[file]">) {
  const icon = icons[(await ctx.params).file];
  if (!icon) notFound();
  return appIcon(icon.size, { maskable: icon.maskable });
}
