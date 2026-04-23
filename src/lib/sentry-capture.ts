/**
 * Thin wrapper around `Sentry.captureException` that never throws, never
 * crashes a route, and works from any server-side code path.
 *
 * Why wrap instead of importing Sentry directly everywhere:
 *
 * 1. **Consistency** — 35+ API routes each need the same "log to console,
 *    ship to Sentry, swallow any Sentry error" pattern. Duplicating that
 *    block 35 times is how we end up with half of them forgetting the
 *    try/catch around the dynamic import.
 *
 * 2. **Dynamic import** — Some routes run in the Edge runtime where the
 *    full `@sentry/nextjs` import tree doesn't resolve cleanly. Dynamic
 *    importing + swallowing the error keeps a misconfigured sentry setup
 *    from taking the route down.
 *
 * 3. **No-op without init** — If `sentry.server.config.ts` / the new
 *    `instrumentation.ts` path isn't wired (local dev without a DSN),
 *    the import still succeeds and `captureException` is a no-op.
 *
 * Usage (API route):
 *
 *     import { captureServerError } from "@/lib/sentry-capture";
 *     // ...
 *     catch (err) {
 *       captureServerError(err, { route: "/api/answer", userId });
 *       return NextResponse.json({ error: "Internal error" }, { status: 500 });
 *     }
 *
 * The second argument (context) attaches breadcrumbs so we can tell
 * "500 on POST /api/answer for user X" from "500 in some other route"
 * in the Sentry issue view.
 *
 * Added 2026-04-22 as part of the launch-readiness sprint's error-budget
 * checklist (context/LAUNCH-READINESS.md — "Sentry coverage on API
 * routes"). The sentry DSN + org/project are already configured in
 * `sentry.server.config.ts` and `next.config.ts`.
 */

export type SentryContext = {
  /** Route path or operation name, e.g. "/api/answer" */
  route?: string;
  /** UUID of the authenticated user when available */
  userId?: string;
  /** Any other tag you want searchable in Sentry */
  [key: string]: string | number | boolean | null | undefined;
};

/**
 * Fire-and-forget Sentry capture. Never awaits the network call, never
 * throws, and never holds up the request/response cycle. The console
 * log is a belt-and-braces fallback so a broken Sentry setup still
 * leaves a trail in Vercel logs.
 */
export function captureServerError(err: unknown, ctx: SentryContext = {}): void {
  // Always leave a trace in stdout — Vercel runtime logs pick this up
  // even when Sentry itself is unhealthy. This is the belt in the
  // belt-and-braces story.
  try {
    const route = ctx.route ? `[${ctx.route}] ` : "";
    // eslint-disable-next-line no-console
    console.error(`${route}captured error:`, err);
  } catch {
    /* noop — console.error should never throw, but guard anyway */
  }

  // Ship to Sentry on a best-effort basis. Dynamic import keeps Edge
  // runtime quiet; the try/catch keeps a missing/misconfigured
  // @sentry/nextjs from taking the route down.
  (async () => {
    try {
      const Sentry = await import("@sentry/nextjs");

      // Attach route + userId as tags so they're first-class in the
      // Sentry issue view (filterable without opening the event).
      // Everything else lands as structured context.
      Sentry.withScope(scope => {
        if (ctx.route) scope.setTag("route", ctx.route);
        if (ctx.userId) scope.setUser({ id: ctx.userId });

        const extras: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(ctx)) {
          if (k === "route" || k === "userId") continue;
          if (v !== undefined) extras[k] = v;
        }
        if (Object.keys(extras).length > 0) {
          scope.setContext("route-context", extras);
        }

        Sentry.captureException(err);
      });
    } catch {
      /* noop — a broken Sentry setup must not break the route */
    }
  })();
}

/**
 * Convenience helper for the common "log + capture + return 500" pattern.
 * Returns the error message (never the raw error) so callers can build
 * a JSON body without leaking stack traces to the client.
 *
 *     const msg = captureAndMessage(err, { route: "/api/x" });
 *     return NextResponse.json({ error: msg }, { status: 500 });
 */
export function captureAndMessage(
  err: unknown,
  ctx: SentryContext = {},
  fallback: string = "Internal error",
): string {
  captureServerError(err, ctx);
  // Don't leak error.message to the client — the Vercel logs + Sentry
  // have the full story. Users see the fallback.
  return fallback;
}
