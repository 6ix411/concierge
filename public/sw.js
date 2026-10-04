// Concierge by 6IX service worker: makes the site installable and shows a friendly page when
// there's no connection. It deliberately caches nothing personal: only the signed-out offline
// page and the build's static files (scripts, styles, fonts), which are the same for everyone.
// Pages, API calls, uploads and anything not GET always go to the network.

const VERSION = "v1";
const OFFLINE_CACHE = `offline-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      // Fetched without cookies so the cached page never shows a signed-in header.
      .then((cache) =>
        fetch(OFFLINE_URL, { credentials: "omit", cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error("Offline page unavailable");
          return cache.put(OFFLINE_URL, response);
        }),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== OFFLINE_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: always the network; the offline page only when there is no connection at all.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE }).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Build files have content hashes in their names, so a cached copy is always correct.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ??
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
  }
});
