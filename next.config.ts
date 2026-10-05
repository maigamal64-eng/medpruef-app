import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
  // connect.facebook.net serves fbevents.js (the Meta Pixel loader).
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://telegram.org https://connect.facebook.net https://t.whop.tw https://m1.openfpcdn.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // www.facebook.com receives the Pixel tracking beacon (/tr as a 1x1 img);
  // connect.facebook.net is the loader origin.
  "img-src 'self' data: blob: https://[project].supabase.co https://www.googletagmanager.com https://www.google-analytics.com https://t.me https://www.facebook.com https://connect.facebook.net https://t.whop.tw",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Pixel also POSTs events to www.facebook.com / connect.facebook.net (fetch/beacon).
  "connect-src 'self' https://[project].supabase.co https://www.google-analytics.com https://region1.google-analytics.com https://*.clarity.ms https://api.openai.com https://api.anthropic.com https://*.ingest.de.sentry.io https://o4511227511504896.ingest.de.sentry.io https://telegram.org https://www.facebook.com https://connect.facebook.net https://t.whop.tw https://m1.openfpcdn.io",
  "frame-src 'self' https://oauth.telegram.org",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  // Reporting — legacy report-uri for broad browser compatibility +
  // modern report-to for browsers that support the Reporting API.
  // Both point to the same /api/csp-report endpoint.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

// Agent-discovery Link headers (RFC 8288 `Link` response header + the
// api-catalog rel from RFC 9727 §3). Lets an agent crawling the homepage
// discover the machine-readable surfaces (api-catalog, OpenAPI spec, human
// API docs, agent-skills index, MCP server card) without guessing URLs.
// `api-catalog` is the load-bearing rel per the originating issue.
//
// Applied to `/` AND `/landing`: the existing middleware (src/middleware.ts)
// 302-redirects an unauthenticated bare `/` request to `/landing`, so an
// agent/scanner that follows redirects lands on `/landing` — the header
// must be there too or it's invisible post-redirect.
//
// Targets are frozen strings owned by sibling agents building those routes;
// do not rename without checking .well-known/agent-skills, openapi.json,
// docs/api, .well-known/mcp/server-card.json.
const AGENT_LINK_HEADER = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</openapi.json>; rel="service-desc"',
  '</docs/api>; rel="service-doc"',
  '</.well-known/agent-skills/index.json>; rel="agent-skills"',
  '</.well-known/mcp/server-card.json>; rel="mcp-server-card"',
].join(", ");

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
  // Reporting-Endpoints: declares the named endpoint "csp-endpoint" used
  // by the report-to CSP directive (modern Reporting API, RFC 7469 successor).
  // Legacy browsers fall back to report-uri. Both point to the same handler.
  {
    key: "Reporting-Endpoints",
    value: `csp-endpoint="/api/csp-report"`,
  },
  // Report-only while we bed in. Violations are stored in the csp_violations
  // Supabase table via /api/csp-report. Scheduled task at
  // ~/.claude/scheduled-tasks/csp-enforcement-check fires 2026-05-14:
  // 0 violations across all directives → flip to Content-Security-Policy;
  // any violations → extend another 2 weeks + create comms/csp-violations-*.md.
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  outputFileTracingIncludes: {
  },

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
    // 2026-09-05: /kmp-innsbruck -> /stichprobentest. The exam's venue rotates
    // every sitting (Innsbruck-Feb, Wien-May, Graz-Sep 2026), so the venue must
    // not live in the URL. Permanent: the old slug carried the page's only
    // rankings, so the equity has to pass through.
    const stichprobentestRedirect = [
      { source: "/kmp-innsbruck", destination: "/stichprobentest", permanent: true },
    ];

    // Admin IA revamp (2026-04-23 §2.1) — legacy /admin/* routes → new homes.
    // Temporary for one release cycle so bookmarked URLs don't 404; remove
    // these once [name] confirms no-one is hitting them in logs.
    const adminLegacyRedirects = [
      { source: "/admin/dashboard", destination: "/admin/overview" },
      { source: "/admin/analytics", destination: "/admin/overview" },
      { source: "/admin/system", destination: "/admin/env" },
      { source: "/admin/changelog", destination: "/admin/overview" },
    ].map((r) => ({ ...r, permanent: false }));

    if (!IS_PRODUCTION) return [...stichprobentestRedirect, ...adminLegacyRedirects];

    return [
      ...stichprobentestRedirect,
      ...adminLegacyRedirects,
      // Catch-all: any .vercel.app host (old project name, stale preview
      // aliases, the old `medpruef-git-main-*.vercel.app` branch alias) →
      // canonical domain. Production deployments are served from the Vercel
      // production alias too, but since this only runs when VERCEL_ENV is
      // "production" AND the host matches .vercel.app, it catches only stale
      // hosts that users still have bookmarked.
      //
      // 2026-10-02: EXCEPT /api/cron/*. Vercel Cron invokes the production
      // DEPLOYMENT host (<deployment>.vercel.app, per the project's cron
      // definitions) and does not follow redirects, so this catch-all turned
      // every scheduled run into a 308 and the daily trial/expiry sweep never
      // executed (zero heartbeats ever). Cron routes stay CRON_SECRET-gated.
      {
        source: "/:path((?!api/cron/).*)",
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
      {
        // Agent-discovery Link header — homepage + its unauthenticated
        // redirect target (see AGENT_LINK_HEADER comment above).
        source: "/",
        headers: [{ key: "Link", value: AGENT_LINK_HEADER }],
      },
      {
        source: "/landing",
        headers: [{ key: "Link", value: AGENT_LINK_HEADER }],
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

// Compute a stable Sentry release name. Uses the 12-char commit SHA
// when Vercel provides one, otherwise falls back to `dev-local` so
// local builds don't emit a fresh "release" per timestamp (same
// rationale as the NEXT_PUBLIC_BUILD_ID fallback above).
//
// Release names let us tie each error event to a specific deploy
// and cut "errors per release" charts in Sentry. The Vercel build
// env also exports SENTRY_RELEASE automatically if
// `automaticVercelMonitors: true` is set, but wiring it explicitly
// here makes the source-map upload path use the same name — so
// uploaded maps match the release Sentry stamps on events.
const SENTRY_RELEASE =
  process.env.SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  "dev-local";

export default withSentryConfig(nextConfig, {
  // Sentry org + project for source map uploads + error grouping.
  org: "medpruf",
  project: "javascript-nextjs",

  // Auth token for source map uploads at build time. On Vercel, set
  // SENTRY_AUTH_TOKEN as an env var. Locally, the token is in
  // ./.env.shared.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Release tag — lets us filter "errors on the 2026-04-22 deploy"
  // in the Sentry UI, and makes source maps stitch to the right
  // release when the Webpack plugin uploads them at build time.
  release: {
    name: SENTRY_RELEASE,
  },

  // Suppress noisy source-map upload logs during build.
  silent: true,

  // Don't widen the Next.js bundle with Sentry tunneling or Webpack
  // plugin features we don't need yet.
  widenClientFileUpload: true,
  disableLogger: true,

  // Auto-instrument server components and API routes.
  automaticVercelMonitors: true,
});
