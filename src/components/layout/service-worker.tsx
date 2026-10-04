"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js so the site can be installed as an app and shows the offline page when
 * there's no connection. Skipped in development, where cached build files would get in the way.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not supported here (private mode, old browser): the site works the same without it.
    });
  }, []);
  return null;
}
