/**
 * Sentry server + edge runtime initialization — Next.js 15 App Router
 * convention (replaces the deprecated `sentry.server.config.ts` bare
 * import). Required by Sentry SDK 10; without it, `captureException`
 * and `captureMessage` on the server/edge runtimes are no-ops.
 *
 * Diagnosed 2026-04-21: Sentry had been configured with a valid DSN +
 * init calls for 5+ days but the project's `firstEvent` was still null.
 * Root cause was this missing file — SDK 10 uses Next.js's
 * `register()` + `onRequestError` hooks rather than scanning the root
 * for `sentry.{server,edge}.config.ts` at build time.
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// App Router error hook — Sentry auto-captures the request error + a
// span of context (headers, URL, matched route). This wires
// React / server-component errors into Sentry the same way
// `captureException` does for client code.
export const onRequestError = Sentry.captureRequestError;
