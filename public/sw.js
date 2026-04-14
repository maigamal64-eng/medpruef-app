// MedPrüf Service Worker — offline caching for study sessions
// v2 (2026-04-14): network-first for HTML + Next.js chunks to prevent stale JS
// after deploys. Only brand/icon static assets are cache-first.
const CACHE_NAME = "medpruef-v2";
const OFFLINE_URL = "/";

// Static assets to cache on install (icons + manifest only — never JS/HTML)
const PRECACHE_URLS = [
  "/manifest.json",
  "/brand/logo-mark.png",
  "/brand/logo-full.png",
  "/brand/wordmark-twotone.png",
  "/brand/favicon-64.png",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/apple-touch-icon.png",
];

// Install — precache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches and claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow clients to force an immediate skipWaiting (optional manual upgrade)
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET
  if (event.request.method !== "GET") return;

  // Only same-origin or Supabase storage
  const isSameOrigin = url.origin === self.location.origin;
  const isSupabaseStorage = url.hostname.includes("supabase.co") && url.pathname.includes("/storage/");
  if (!isSameOrigin && !isSupabaseStorage) return;

  // === Network-first: HTML pages ===
  // Cache is only a last-resort offline fallback (never serve stale HTML on live network)
  if (event.request.mode === "navigate" ||
      (event.request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((c) => c || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // === Network-first: Next.js chunks and build output ===
  // Next.js uses content-hashed filenames, so stale chunks are broken after deploy.
  // Fetch from network; only fall back to cache offline.
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // === Network-first: API calls ===
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful read APIs for offline browsing
          if (response.ok && (url.pathname.includes("/questions") || url.pathname.includes("/stats"))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // === Cache-first: Supabase storage images (question images rarely change) ===
  if (isSupabaseStorage) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // === Cache-first: brand/icon static assets ===
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
