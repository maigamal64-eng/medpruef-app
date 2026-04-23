import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://user-edc7605a@example.com/0",
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",

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
