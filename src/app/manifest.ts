import type { MetadataRoute } from "next";

import { ICON_BACKGROUND } from "@/lib/pwa/icon";

/** Lets phones install Concierge from the browser ("Add to Home Screen" / "Install app"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Concierge by 6IX",
    short_name: "Concierge",
    description: "Tell our concierge what you need and get matched with verified businesses.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: ICON_BACKGROUND,
    theme_color: ICON_BACKGROUND,
    categories: ["lifestyle", "shopping", "business"],
    icons: [
      { src: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Find My Provider", url: "/concierge" },
      { name: "My bookings", url: "/account/bookings" },
      { name: "Messages", url: "/account/messages" },
    ],
  };
}
