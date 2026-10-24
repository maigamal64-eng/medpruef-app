import type { NextConfig } from "next";
import { MENTOR_FACT_TRACE } from "./src/lib/mentor/deployment-manifest";
import { cardTrialBuildGateError, cardTrialBuildMirror } from "./src/lib/card-trial-gate";
import { withSentryConfig } from "@sentry/nextjs";

// Canonical host — all production traffic should land here. Any request from
// a non-canonical host (old Vercel preview URLs, stale bookmarks, the old
// `preview-3626e8.vercel.app` project alias) is 308-redirected here.
const CANONICAL_HOST = "medpruf.com";

// Only redirect on the production deployment. Vercel preview deploys (PRs,
// branch previews) must continue to serve from their .vercel.app URL, or
// every preview would just bounce to production.
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

// Vercel's build container sets VERCEL=1 (system env, exposed for this project).
// Only there does the build skip ESLint and the type check; see nextConfig below.
const SKIP_BUILD_CHECKS = process.env.VERCEL === "1";

// release-int-3 flip gate (decisions flip-gate and referral-rule LD-1 = A): the
// referral copy follows the reverse-trial build mirror below, the server rule
// follows REFERRAL_REQUIRE_CARD_TRIAL (isCardTrialRequired). A build with the
// reverse trial on and the card requirement still on would promise referees a
// reward the server refuses, so the build fails instead of shipping that.
if (
  process.env.REVERSE_TRIAL_ENABLED === "true" &&
  Boolean(process.env.REVERSE_TRIAL_SINCE) &&
  (process.env.REFERRAL_REQUIRE_CARD_TRIAL ?? "true") !== "false"
) {
  throw new Error("flip gate: REVERSE_TRIAL_ENABLED is on, so REFERRAL_REQUIRE_CARD_TRIAL must be the literal 'false' in the same deploy");
}

// a-trial-phone-gate ([name] 17 Oct, trial-phone-backed): with the reverse trial
// on, the public copy says the trial starts once the account is linked to
// Telegram, so the link path (TELEGRAM_LINK_ENABLED plus a 32-byte
// REMINDER_LINK_SIGNING_SECRET) must ship in the same deploy (Reviewer P2).
if (
  process.env.REVERSE_TRIAL_ENABLED === "true" &&
  Boolean(process.env.REVERSE_TRIAL_SINCE) &&
  (process.env.TELEGRAM_LINK_ENABLED !== "true" || Buffer.byteLength(process.env.REMINDER_LINK_SIGNING_SECRET ?? "") < 32)
) {
  throw new Error("flip gate: REVERSE_TRIAL_ENABLED is on, so TELEGRAM_LINK_ENABLED must be 'true' and REMINDER_LINK_SIGNING_SECRET set (32+ bytes) in the same deploy");
}

// a-card-trial-build-1024 (decision whop-card-trial-1024): the 3-day card
// trial never ships next to the reverse trial or the 7-day trial, and never
// without its Whop plan (src/lib/card-trial-gate.ts).
const cardTrialGateError = cardTrialBuildGateError(process.env);
if (cardTrialGateError) throw new Error(cardTrialGateError);

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
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://telegram.org https://connect.facebook.net https://t.whop.tw https://m1.openfpcdn.io https://app.intercom.io https://widget.intercom.io https://js.intercomcdn.com https://scripts.clarity.ms https://www.redditstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // www.facebook.com receives the Pixel tracking beacon (/tr as a 1x1 img);
  // connect.facebook.net is the loader origin.
  "img-src 'self' data: blob: https://[project].supabase.co https://c.clarity.ms https://*.clarity.ms https://www.googletagmanager.com https://www.google-analytics.com https://t.me https://www.facebook.com https://connect.facebook.net https://t.whop.tw https://js.intercomcdn.com https://static.intercomassets.com https://downloads.intercomcdn.com https://uploads.intercomusercontent.com https://gifs.intercomcdn.com https://video-messages.intercomcdn.com https://messenger-apps.intercom.io https://*.intercom-attachments-1.com https://*.intercom-attachments-2.com https://*.intercom-attachments-3.com https://*.intercom-attachments-4.com https://*.intercom-attachments-5.com https://*.intercom-attachments-6.com https://*.intercom-attachments-7.com https://*.intercom-attachments-8.com https://*.intercom-attachments-9.com https://static.intercomassets.eu https://static.au.intercomassets.com https://downloads.intercomcdn.eu https://downloads.au.intercomcdn.com https://messenger-apps.eu.intercom.io https://messenger-apps.au.intercom.io https://*.intercom-attachments.eu https://*.au.intercom-attachments.com",
  "font-src 'self' data: https://fonts.gstatic.com https://js.intercomcdn.com https://fonts.intercomcdn.com",
  "media-src 'self' https://js.intercomcdn.com https://downloads.intercomcdn.com https://downloads.intercomcdn.eu https://downloads.au.intercomcdn.com",
  // Pixel also POSTs events to www.facebook.com / connect.facebook.net (fetch/beacon).
  "connect-src 'self' https://[project].supabase.co wss://[project].supabase.co https://alb.reddit.com https://pixel-config.reddit.com https://stats.g.doubleclick.net https://www.google-analytics.com https://region1.google-analytics.com https://*.clarity.ms https://api.openai.com https://api.anthropic.com https://*.ingest.de.sentry.io https://o4511227511504896.ingest.de.sentry.io https://telegram.org https://www.facebook.com https://connect.facebook.net https://t.whop.tw https://m1.openfpcdn.io https://via.intercom.io https://api.intercom.io https://api.eu.intercom.io https://api.au.intercom.io https://api-iam.intercom.io https://api-iam.eu.intercom.io https://api-iam.au.intercom.io https://api-ping.intercom.io https://*.intercom-messenger.com wss://*.intercom-messenger.com https://nexus-websocket-a.intercom.io wss://nexus-websocket-a.intercom.io https://nexus-websocket-b.intercom.io wss://nexus-websocket-b.intercom.io https://nexus-europe-websocket.intercom.io wss://nexus-europe-websocket.intercom.io https://nexus-australia-websocket.intercom.io wss://nexus-australia-websocket.intercom.io https://uploads.intercomcdn.com https://uploads.intercomcdn.eu https://uploads.au.intercomcdn.com https://uploads.eu.intercomcdn.com https://uploads.intercomusercontent.com",
  "frame-src 'self' https://www.facebook.com https://oauth.telegram.org https://intercom-sheets.com https://messenger-apps.intercom.io https://messenger-apps.eu.intercom.io https://messenger-apps.au.intercom.io https://www.intercom-reporting.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://www.facebook.com https://intercom.help https://api-iam.intercom.io https://api-iam.eu.intercom.io https://api-iam.au.intercom.io",
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

  // a-n2-build-oom-1023: on Vercel (VERCEL=1 at build time) `next build` skips
  // its own ESLint and type check. Those two workers (about 2 GB and 1.6 GB)
  // ran on top of the compiled main process and killed two builds that had
  // restored a build cache (OOM, 15 and 22 Oct, 8 GB machine). The gate moved
  // to the head checks: `npm run gate:build` (scripts/release/build-gate.mjs)
  // writes the route types, runs tsc --noEmit and eslint src, and must exit 0
  // before a head is pushed to main. Every non-Vercel build keeps both checks.
  typescript: { ignoreBuildErrors: SKIP_BUILD_CHECKS },
  eslint: { ignoreDuringBuilds: SKIP_BUILD_CHECKS },

  outputFileTracingIncludes: {
    // Mentor verified facts are read from disk at runtime by the facts loader;
    // without this the chat function ships zero facts and refuses everything.
    ...MENTOR_FACT_TRACE,
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
      // a-truth-blog 2026-10-15: the retake-fee story is retired. The closest
      // live page for the SIP block retake moment is the official SIP rules page.
      { source: "/blog/kenntnispruefung-zweiter-versuch", destination: "/wien-route/sip-regeln", permanent: true },
      // a-seo-from-gsc 2026-10-15: a typo link (double "pruef") is a 404 in
      // Search Console with impressions; one permanent hop to the real page.
      { source: "/kenntnispruepruefung-wien", destination: "/kenntnispruefung-wien", permanent: true },
    ];

    // Legacy /admin/* routes → their current homes. The page files are gone
    // (ADM-24 A, UX-ADM-40, a20 2026-10-12): one server redirect each, the
    // query string is kept, no client stub flashes a blank page. Every target
    // is readable by any admin role or by the role the old page needed:
    // /admin/system lands on Today (not /admin/env, which needs system.read),
    // /admin/waitlist lands on Growth (both revenue.read). Remove once logs
    // show no hits.
    const adminLegacyRedirects = [
      { source: "/admin/dashboard", destination: "/admin/overview" },
      { source: "/admin/analytics", destination: "/admin/overview" },
      { source: "/admin/system", destination: "/admin/overview" },
      { source: "/admin/changelog", destination: "/admin/overview" },
      { source: "/admin/control-plane", destination: "/admin/overview" },
      { source: "/admin/launch", destination: "/admin/overview" },
      { source: "/admin/plan", destination: "/admin/overview" },
      { source: "/admin/actions", destination: "/admin/overview" },
      { source: "/admin/sql", destination: "/admin/overview" },
      { source: "/admin/funnels", destination: "/admin/growth" },
      { source: "/admin/experiments", destination: "/admin/growth" },
      { source: "/admin/waitlist", destination: "/admin/growth" },
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
    // Build-time copy of VERCEL_ENV so the browser Sentry init can tell a
    // real deployment from a local run. Empty string = not on Vercel.
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV || "",
    // a-pricing-v2: the one switch of the v2 offer, read at build so every
    // price surface (server and client) agrees; src/lib/pricing-v2/flag.ts.
    NEXT_PUBLIC_PRICING_V2: process.env.PRICING_V2_ENABLED === "true" ? "true" : "",
    // a-public-selftest: build mirror of PUBLIC_SELFTEST_ENABLED for the client entry links; flip with a redeploy.
    NEXT_PUBLIC_PUBLIC_SELFTEST: process.env.PUBLIC_SELFTEST_ENABLED === "true" ? "true" : "",
    // a-code-front-door: build-time mirror of CODE_AT_SIGNUP_ENABLED (src/lib/code-entry); flip with a redeploy.
    NEXT_PUBLIC_CODE_AT_SIGNUP: process.env.CODE_AT_SIGNUP_ENABLED === "true" ? "true" : "",
    // a-checkout-return-read (gated in a-release-int-5): the browser marker and the return
    // reader exist only in a build with CHECKOUT_RETURN_READ_ENABLED=true; flip with a redeploy.
    NEXT_PUBLIC_CHECKOUT_RETURN_READ: process.env.CHECKOUT_RETURN_READ_ENABLED === "true" ? "true" : "",
    // a-tg-checkout-context: build mirror of TG_CHECKOUT_OPENLINK_ENABLED (src/lib/checkout-context.ts):
    // Mini App checkouts open through Telegram.WebApp.openLink and the sessionless return state shows.
    NEXT_PUBLIC_TG_CHECKOUT_OPENLINK: process.env.TG_CHECKOUT_OPENLINK_ENABLED === "true" ? "true" : "",
    NEXT_PUBLIC_REVERSE_TRIAL: process.env.REVERSE_TRIAL_ENABLED === "true" && Boolean(process.env.REVERSE_TRIAL_SINCE) ? "true" : "",
    // a-card-trial-build-1024: build mirror of CARD_TRIAL_ENABLED (src/lib/card-trial.ts); flip with a redeploy.
    NEXT_PUBLIC_CARD_TRIAL: cardTrialBuildMirror(process.env),
    // a-intercom-contact-sync: the privacy page names the Intercom contact
    // sync only in a build where the server flag is on (flip = redeploy).
    NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC: process.env.MEDPRUF_INTERCOM_SYNC_ENABLED === "true" ? "true" : "",
    // a-intercom-telegram-bridge: the privacy page names Intercom for the
    // Telegram relay exactly in builds where the bridge runs (flip = redeploy).
    // a-intercom-into-n2n3-1021: the privacy page names the feedback tickets only in a
    // build where MEDPRUF_INTERCOM_TICKETS_ENABLED is on (flip = redeploy).
    NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS: process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED === "true" ? "true" : "",
    NEXT_PUBLIC_TELEGRAM_INTERCOM_BRIDGE:
      process.env.TELEGRAM_INTERCOM_BRIDGE_ENABLED === "true" ? "true" : "",
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
