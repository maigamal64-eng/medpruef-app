import { NextResponse } from "next/server";

export const dynamic = "force-static";
export const revalidate = false;

// Service worker served dynamically so that every deploy produces a fresh
// CACHE_NAME tied to the Vercel commit SHA. This forces old caches to be
// purged immediately on activation, preventing the stale-JS-after-deploy
// issue that caused the "flags still show Anonymous" bug on 2026-04-13.
//
// Rewritten from /sw.js (see next.config.ts rewrites).
//
// IMPORTANT: the fallback MUST be stable across requests. Earlier versions
// used `dev-${Date.now()}` here, which made the SW body byte-different on
// every fetch — every 60s poll in PWAInstall.tsx saw a "new" worker and
// showed the "Reload now" banner in an endless loop (fixed 2026-04-15).
// The fallback now uses `dev-local`, which matches the same stable fallback
// in next.config.ts so client EXPECTED and SW BUILD_ID agree in dev.

function getBuildId(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.NEXT_BUILD_ID ||
    "dev-local"
  );
}

export async function GET() {
  const buildId = getBuildId();
  const cacheName = `medpruef-${buildId}`;

  const body = `// MedPrüf Service Worker — dynamically versioned (build ${buildId})
// Network-first for HTML + Next.js chunks to prevent stale JS after deploys.
// Only brand/icon static assets are cache-first.
const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const OFFLINE_URL = "/";

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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {
            /* ignore individual failures so install doesn't abort */
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: "window" }).then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: "SW_UPDATED", buildId: BUILD_ID });
          }
        })
      )
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_BUILD_ID") {
    event.source && event.source.postMessage({ type: "BUILD_ID", buildId: BUILD_ID });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;

  const isSameOrigin = url.origin === self.location.origin;
  const isSupabaseStorage =
    url.hostname.includes("supabase.co") && url.pathname.includes("/storage/");
  if (!isSameOrigin && !isSupabaseStorage) return;

  // Never cache the SW file itself or its rewrite target
  if (url.pathname === "/sw.js" || url.pathname === "/api/sw") return;

  // Network-first: HTML navigations
  if (
    event.request.mode === "navigate" ||
    (event.request.headers.get("accept") || "").includes("text/html")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((c) => c || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Network-first: Next.js build output (content-hashed but cache gets pinned across deploys)
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

  // Network-first: API calls
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (
            response.ok &&
            (url.pathname.includes("/questions") || url.pathname.includes("/stats"))
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first: Supabase storage images
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

  // Cache-first: brand/icon static assets (small and rarely change)
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
`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // SW file must always be fetched fresh from network so new deploys activate
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
