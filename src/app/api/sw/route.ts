import { NextResponse } from "next/server";
import { OFFLINE_IMAGE_CACHE } from "@/lib/master-pwa/offline-images";

export const dynamic = "force-static";
export const maxDuration = 30;
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
// Cache static assets and build-hashed chunks. User pages and API responses
// are kept out of Cache Storage because they may contain account data.
const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const OFFLINE_URL = "/offline.html";
// Images of a learner's offline pack (LX-16): kept across deploys, emptied by
// "Offline-Daten löschen". Holds only question images, never pages or API data.
const OFFLINE_IMAGE_CACHE = ${JSON.stringify(OFFLINE_IMAGE_CACHE)};

const PRECACHE_URLS = [
  "/manifest.json",
  "/offline.html",
  "/brand/logo-mark.png",
  "/brand/logo-full.png",
  "/brand/wordmark-twotone.png",
  "/brand/favicon-64.png",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/icon-maskable-512.png",
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
  // Do not replace the active worker automatically. PWAInstall exposes the
  // waiting worker as an explicit update action so an in-progress learner can
  // finish before the client changes versions.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== OFFLINE_IMAGE_CACHE)
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
    (url.hostname === "supabase.co" || url.hostname.endsWith(".supabase.co")) &&
    url.pathname.includes("/storage/");
  if (!isSameOrigin && !isSupabaseStorage) return;

  // Never cache the SW file itself or its rewrite target
  if (url.pathname === "/sw.js" || url.pathname === "/api/sw") return;

  // Never persist rendered pages. They can include a signed-in user's state.
  // The standalone offline page is precached and contains no account data.
  if (
    event.request.mode === "navigate" ||
    (event.request.headers.get("accept") || "").includes("text/html")
  ) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 5000);
    event.respondWith(
      fetch(event.request, { signal: controller.signal })
        .catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
        .finally(() => clearTimeout(deadline))
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

  // API responses can be account-specific, so the service worker never
  // stores them. Offline study uses the explicit IndexedDB question store.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Network-first: Supabase storage images. Online, a replaced image is
  // always fresh; offline, the stored copy answers (pack images from
  // OFFLINE_IMAGE_CACHE or a passively stored public image).
  if (isSupabaseStorage) {
    // With a stored copy, the same 5 s budget as navigations: a weak
    // connection falls back to the copy. Without one, a slow image is still
    // better than a broken one, so the request runs without a deadline.
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request);
        const imageController = cached ? new AbortController() : null;
        const imageDeadline = imageController ? setTimeout(() => imageController.abort(), 5000) : null;
        try {
          const response = await fetch(
            event.request,
            imageController ? { signal: imageController.signal } : undefined
          );
          const cacheControl = response.headers.get("cache-control") || "";
          const vary = response.headers.get("vary") || "";
          if (
            response.ok &&
            /(?:^|,)\\s*public\\b/i.test(cacheControl) &&
            !/private|no-store|no-cache|max-age=0/i.test(cacheControl) &&
            vary.trim() !== "*" &&
            !/cookie|authorization|x-session-token/i.test(vary)
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        } catch {
          return cached || Response.error();
        } finally {
          if (imageDeadline) clearTimeout(imageDeadline);
        }
      })()
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
