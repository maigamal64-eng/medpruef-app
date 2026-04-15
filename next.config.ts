import type { NextConfig } from "next";

// Canonical host — all production traffic should land here. Any request from
// a non-canonical host (old Vercel preview URLs, stale bookmarks, the old
// `preview-3626e8.vercel.app` project alias) is 308-redirected here.
const CANONICAL_HOST = "medpruf.com";

// Only redirect on the production deployment. Vercel preview deploys (PRs,
// branch previews) must continue to serve from their .vercel.app URL, or
// every preview would just bounce to production.
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

// Content Security Policy — starts as report-only so a bad directive
// can't break the site. Once Clarity / Vercel logs show no violations
// for 1-2 weeks, flip `Content-Security-Policy-Report-Only` to
// `Content-Security-Policy` below. The two inline <script> blocks in
// layout.tsx (SW kill-switch, GA init, Clarity init, JSON-LD) all need
// 'unsafe-inline' since they're not nonce'd; that's the pragmatic
// choice given the existing inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://[project].supabase.co https://www.googletagmanager.com https://www.google-analytics.com https://t.me",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://[project].supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://*.clarity.ms https://api.openai.com",
  "frame-src 'self' https://oauth.telegram.org",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Global security headers. Apply to every route except the SW file
// (which needs its own cache-control override, handled separately in
// the headers() block below).
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Report-only while we bed in. Flip to `Content-Security-Policy`
  // once the Vercel log drain (or Sentry, once installed) shows no
  // violation reports for 1-2 weeks.
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

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
      {
        // Global security headers applied to every HTML / API / static route.
        // Added 2026-04-15 after the full audit (reports/review-2026-04-15/
        // 07-infra.md and 01-security.md both flagged the complete absence
        // of CSP / XFO / Referrer / Permissions headers).
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },

  env: {
    // Expose build ID to the client so captureClientContext() can stamp it
    // onto flag/feedback submissions.
    //
    // IMPORTANT: the fallback MUST be stable (no Date.now()). The SW route
    // at /api/sw uses the same stable fallback, so the inline kill-switch
    // in layout.tsx compares EXPECTED == SW BUILD_ID and agrees in dev. An
    // earlier version used `dev-${Date.now()}` here, which caused the
    // "Reload now" banner to reappear every 60s in dev and on any non-
    // Vercel host because the SW body kept byte-changing (fixed 2026-04-15).
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
      "dev-local",
  },
};

export default nextConfig;
