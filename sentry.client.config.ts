import * as Sentry from "@sentry/nextjs";
import { shouldDropChunkEvent } from "@/lib/master-pwa/chunk-recovery";

Sentry.init({
  dsn: "https://user-edc7605a@example.com/0",

  // Only real Vercel deployments report. NEXT_PUBLIC_DEPLOY_ENV is the
  // build-time VERCEL_ENV (see next.config.ts); empty means a local build
  // or `next start`, which must not count as production. Localhost
  // hostnames are excluded as a second guard.
  enabled:
    process.env.NODE_ENV === "production" &&
    (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production" ||
      process.env.NEXT_PUBLIC_DEPLOY_ENV === "preview") &&
    !(
      typeof window !== "undefined" &&
      /^(localhost|127\.0\.0\.1|\[::1\])$|\.local$/.test(window.location.hostname)
    ),

  // Sample 100% of errors (free tier is 5k events/month — plenty for
  // current MedPrüf load). Lower this if volume grows.
  tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
  replaysSessionSampleRate: 0, // Disable session replay (saves quota)
  replaysOnErrorSampleRate: 0.5, // Capture 50% of sessions with errors

  // Don't send PII (we handle user identity ourselves)
  sendDefaultPii: false,

  // Environment tagging
  environment: process.env.NEXT_PUBLIC_DEPLOY_ENV || "local",

  // Release tag — must match the `release.name` in next.config.ts so
  // events + source maps line up. The Sentry build plugin auto-injects
  // NEXT_PUBLIC_SENTRY_RELEASE at build time from that config; falling
  // back to the commit SHA lets us still tag events if the plugin
  // didn't run (e.g. an edge-case preview build).
  release:
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
    process.env.NEXT_PUBLIC_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    undefined,

  // A failed chunk/module load is fixed by one guarded reload
  // (src/lib/master-pwa/chunk-recovery.ts); only the tagged event of a blocked
  // second reload is sent.
  beforeSend(event, hint) {
    return shouldDropChunkEvent(event, hint?.originalException) ? null : event;
  },
});
