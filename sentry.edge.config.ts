import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://user-edc7605a@example.com/0",
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
});
