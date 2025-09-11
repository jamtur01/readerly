/* Readerly Service Worker
   Basic offline support:
   - Precache app shell routes
   - Cache-first for Next static assets
   - Network-first with fallback for API GETs
   - Keeps a small runtime cache for offline navigation
*/

const STATIC_CACHE = "readerly-static-v1";
const RUNTIME_CACHE = "readerly-runtime-v1";

const PRECACHE_URLS = [
  "/",
  "/login",
  "/sharing"
];

// Utility: detect HTML requests by Accept header
function isHtmlRequest(req) {
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

// Cache helpers
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) {
    cache.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreVary: true });
    if (cached) return cached;
    if (req.mode === "navigate") {
      // Fallback to app shell when offline navigation occurs
      const shell = await caches.match("/", { ignoreVary: true });
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    try {
      await cache.addAll(PRECACHE_URLS);
    } catch {
      // Best-effort: ignore failures for routes not built yet
    }
    // Activate new SW immediately
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        if (k !== STATIC_CACHE && k !== RUNTIME_CACHE) {
          return caches.delete(k);
        }
        return Promise.resolve(true);
      })
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;

  // Next.js build assets and icons: cache-first
  const isNextAsset =
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/favicon") ||
    url.pathname.startsWith("/icons");

  // API GETs: network-first with fallback to cache
  const isApiGet =
    url.pathname.startsWith("/items") ||
    url.pathname.startsWith("/search") ||
    url.pathname.startsWith("/subscriptions") ||
    url.pathname.startsWith("/saved-searches") ||
    url.pathname.startsWith("/sharing/me");

  // Navigations and HTML: network-first so user gets fresh content if online
  const isHtml = req.mode === "navigate" || isHtmlRequest(req);

  if (isNextAsset) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  if (isApiGet) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  if (isHtml) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      return res;
    } catch {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req, { ignoreVary: true });
      if (cached) return cached;
      // As a last resort for navigations, return app shell
      if (req.mode === "navigate") {
        const shell = await caches.match("/", { ignoreVary: true });
        if (shell) return shell;
      }
      // Let the error surface
      throw new Error("Network error and no cached response available");
    }
  })());
});