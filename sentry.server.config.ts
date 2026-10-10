import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://user-edc7605a@example.com/0",
  // Gated on VERCEL_ENV: only real Vercel deployments report. A local
  // `next start` / test run has NODE_ENV=production but no VERCEL_ENV and
  // must not count as production.
  enabled:
    process.env.NODE_ENV === "production" &&
    (process.env.VERCEL_ENV === "production" ||
      process.env.VERCEL_ENV === "preview"),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || "local",

  // Release tag — mirrors the client config so server + client events
  // group under the same release. The Sentry build plugin populates
  // SENTRY_RELEASE for the server runtime based on `release.name` in
  // next.config.ts; the fallbacks keep tagging working when the plugin
  // was skipped (local node server, preview build without auth token).
  release:
    process.env.SENTRY_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    undefined,
});
