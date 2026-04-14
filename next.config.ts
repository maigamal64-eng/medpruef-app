import type { NextConfig } from "next";

// Canonical host — all production traffic should land here. Any request from
// a non-canonical host (old Vercel preview URLs, stale bookmarks, the old
// `preview-3626e8.vercel.app` project alias) is 308-redirected here.
const CANONICAL_HOST = "medpruf.com";

// Only redirect on the production deployment. Vercel preview deploys (PRs,
// branch previews) must continue to serve from their .vercel.app URL, or
// every preview would just bounce to production.
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Dynamic, build-versioned service worker.
      // /public/sw.js was removed — the file is served from /api/sw with the
      // current Vercel commit SHA injected into CACHE_NAME, so every deploy
      // purges the old cache on activate.
      { source: "/sw.js", destination: "/api/sw" },
    ];
  },

  async redirects() {
    if (!IS_PRODUCTION) return [];

    return [
      // Catch-all: any .vercel.app host (old project name, stale preview
      // aliases, the old `medpruef-git-main-*.vercel.app` branch alias) →
      // canonical domain. Production deployments are served from the Vercel
      // production alias too, but since this only runs when VERCEL_ENV is
      // "production" AND the host matches .vercel.app, it catches only stale
      // hosts that users still have bookmarked.
      {
        source: "/:path*",
        has: [{ type: "host", value: "(?<vhost>.+)\\.vercel\\.app" }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
      // Explicit old alternate spelling → canonical
      {
        source: "/:path*",
        has: [{ type: "host", value: "medpruef.com" }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
      // www → apex
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.medpruf.com" }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        // SW file must always be fetched fresh — no HTTP caching.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },

  env: {
    // Expose build ID to the client so captureClientContext() can stamp it
    // onto flag/feedback submissions. Falls back to a dev timestamp locally.
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
      `dev-${Date.now()}`,
  },
};

export default nextConfig;
