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

  // Release tag — keeps edge-runtime events grouped with the same
  // release as client/server. See sentry.server.config.ts for the
  // rationale.
  release:
    process.env.SENTRY_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    undefined,
});
