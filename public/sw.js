/*
 * Liftmora service worker.
 *
 * It makes the app installable and keeps it from showing a browser error page when the connection
 * drops, and nothing more. It deliberately does NOT cache pages, API responses or anything personal:
 * member details, QR codes and payments must never be readable from a shared phone's cache, and a stale
 * page could show a check-in or balance that is no longer true.
 *
 *  - install: store the offline page and the app icons
 *  - page loads: always go to the network; if it fails, show the offline page
 *  - /_next/static and /icons: fixed files, so serve them from cache once fetched (fast, works offline)
 *  - everything else (API calls, uploads, other sites): left alone, never intercepted
 */
const CACHE = "liftmora-static-v1";
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});
