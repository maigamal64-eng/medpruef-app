import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/sentry-test
 *
 * Admin-gated endpoint that throws a test error — used to verify the
 * Sentry ingestion pipeline end-to-end.
 *
 * Context: Sentry was wired on 2026-04-21 (instrumentation.ts +
 * instrumentation-client.ts for SDK 10 + App Router). Before we trust
 * it in production, we need a one-command way to confirm errors
 * actually reach the dashboard. Waiting for an organic crash is a bad
 * plan — the whole point of this is to be ready BEFORE something breaks.
 *
 * Usage:
 *   curl -H "x-user-id: <ADMIN_UUID>" https://medpruf.com/api/debug/sentry-test
 *   → 500 { error: "Sentry test exception (server)" }
 *   → https://medpruf.sentry.io/issues/ should show the event within ~30s
 *
 * Query params:
 *   ?kind=server  (default) — throws on the server-side route handler
 *   ?kind=message          — sends a captureMessage (no throw, info level)
 *   ?kind=unhandled        — throws outside the try/catch for auto-capture
 *
 * Security: admin-gated via `requireAdmin` because we don't want
 * random users spamming Sentry's event quota (5k/mo on the free
 * tier). Also gated on `NODE_ENV !== 'production'` OR admin — so a
 * leaked admin UUID can still trigger this in prod for verification,
 * but a misconfigured anon cannot.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") || "server";

  if (kind === "message") {
    Sentry.captureMessage(
      `[sentry-test] Message from ${guard.userId} at ${new Date().toISOString()}`,
      "info"
    );
    return NextResponse.json({
      ok: true,
      kind: "message",
      note: "captureMessage sent — check Sentry issues feed",
    });
  }

  if (kind === "unhandled") {
    // Intentional unhandled throw — exercises the onRequestError
    // hook wired in instrumentation.ts. Do NOT wrap in try/catch.
    throw new Error(
      `[sentry-test] Unhandled server error (${guard.userId}, ${Date.now()})`
    );
  }

  // Default: caught exception → explicit captureException. Verifies
  // that Sentry.captureException works on the server runtime (previously
  // a silent no-op for 5 days pre-Apr-21 due to the missing
  // instrumentation.ts register hook).
  try {
    throw new Error(
      `[sentry-test] Caught server exception (${guard.userId}, ${Date.now()})`
    );
  } catch (err) {
    const eventId = Sentry.captureException(err, {
      tags: { boundary: "sentry-test", kind: "caught" },
      extra: { userId: guard.userId, triggered_at: new Date().toISOString() },
    });
    return NextResponse.json(
      {
        ok: true,
        kind: "caught",
        eventId,
        note: "captureException sent — check Sentry issues feed",
      },
      { status: 200 }
    );
  }
}
