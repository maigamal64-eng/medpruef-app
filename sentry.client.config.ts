import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://user-edc7605a@example.com/0",

  // Only send errors in production. In dev, log to console instead.
  enabled: process.env.NODE_ENV === "production",

  // Sample 100% of errors (free tier is 5k events/month — plenty for
  // current MedPrüf load). Lower this if volume grows.
  tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
  replaysSessionSampleRate: 0, // Disable session replay (saves quota)
  replaysOnErrorSampleRate: 0.5, // Capture 50% of sessions with errors

  // Don't send PII (we handle user identity ourselves)
  sendDefaultPii: false,

  // Environment tagging
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
});
