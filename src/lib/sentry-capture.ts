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

import { isDbUnavailable } from "@/lib/db-unavailable";

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
  // A database stall (DbUnavailableError, its PostgREST shape, Postgres
  // 57014) is not a code defect: learners already get 503 + Retry-After and
  // the db-health watch alerts on outages. Keep a log line, skip Sentry
  // (JAVASCRIPT-NEXTJS-8 grouped 436 such stalls under one issue).
  if (isDbUnavailable(err)) {
    try {
      const route = ctx.route ? `[${ctx.route}] ` : "";
      console.warn(`${route}database unavailable (not sent to Sentry):`, errorSummary(err));
    } catch {
      /* noop */
    }
    return;
  }

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
        // Plain PostgREST error objects carry no stack, so Sentry grouped
        // every failure of a route under one synthetic issue. Split by
        // route, phase/step and error code instead (stable, low cardinality).
        scope.setFingerprint(sentryFingerprint(err, ctx));
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

function errorSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown };
    return [e.code, e.message].filter(v => typeof v === "string" || typeof v === "number").join(" ") || "[object]";
  }
  return String(err);
}

/**
 * First message line with the variable parts removed (numbers, uuids,
 * emails, provider and other ids, quoted values, JSON), so one cause keeps
 * one fingerprint.
 */
export function normalizedMessageLine(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
        ? ((err as { message: string }).message)
        : typeof err === "string"
          ? err
          : "";
  const first = raw.split("\n")[0] ?? "";
  return first
    .replace(/[{[].*$/, "")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "?")
    .replace(/[^\s@]+@[^\s@]+/g, "?")
    .replace(/\b(?:mem|mber|pay|plan|biz|ch)_[A-Za-z0-9]+\b/g, "?")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "?")
    .replace(/\b[a-z]+_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}\b/g, "?")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Sentry fingerprint for a server error: route, phase (or step) and the
 * error's own code; the normalized first message line only when the caller
 * names no phase or step, so different causes on one route stay apart
 * without one issue per variable message. Error instances also keep the
 * default stack grouping.
 */
export function sentryFingerprint(err: unknown, ctx: SentryContext = {}): string[] {
  const phase = ctx.phase ?? ctx.step;
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  const parts = [
    ctx.route ?? "unknown",
    phase === undefined || phase === null ? "" : String(phase),
    typeof code === "string" || typeof code === "number" ? String(code) : "",
  ];
  if (phase === undefined || phase === null) parts.push(normalizedMessageLine(err));
  // A real Error has a stack: keep Sentry's own stack grouping inside the
  // split so two different bugs in one phase do not merge.
  return err instanceof Error ? ["{{ default }}", ...parts] : parts;
}

/**
 * Add a breadcrumb to the current Sentry scope. Used to leave a trace
 * of the path a request took through a multi-step route (auth check,
 * tier check, upstream call, cache write, etc.) so when an error fires
 * later, Sentry's issue view shows the full sequence.
 *
 * Fire-and-forget; never throws. Returns immediately if Sentry isn't
 * available (Edge runtime, dev without DSN, etc.).
 *
 * Usage:
 *   addBreadcrumb({ category: "ai-chat", message: "tier_check", data: { tier } });
 */
export function addBreadcrumb(args: {
  category: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
}): void {
  (async () => {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.addBreadcrumb({
        category: args.category,
        message: args.message,
        level: args.level ?? "info",
        data: args.data,
      });
    } catch {
      /* noop */
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
