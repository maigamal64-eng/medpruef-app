import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit } from "@/lib/rate-limit";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { recordEventSafe } from "@/lib/user-events";
import { sanitizeEventData } from "@/lib/analytics-events";
import { checkoutReturnReadEnabled } from "@/lib/checkout-return-read";
import { hasEventSince, returnDecisionFor } from "@/lib/checkout-return-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const IDLE = { recorded: false, prompt: false };

/**
 * POST /api/checkout-return (a-checkout-return-read), default off
 * (CHECKOUT_RETURN_READ_ENABLED; 404 before any read while off).
 *
 *  - { kind: "return", page }: the browser says it left for Whop within 2 hours
 *    and this is its first in-app page since. The server decides from
 *    payment_events (never from the client): a checkout_redirected in the
 *    window, no grant since, none of the a-checkout-resume exclusions. It writes
 *    one user_events `checkout_return` per redirect {bucket, tier, page} and
 *    answers `prompt: true` when the one-tap reasons may show on /pricing.
 *  - { kind: "stall_shown", surface }: the stall prompt really rendered.
 *
 * Reads run cheapest-first: the learner's recent payment events decide with what
 * the guard already knows; only a learner who would qualify costs the users,
 * refund and do-not-contact reads.
 */
export const POST = withDbUnavailable(async (req: NextRequest) => {
  if (!checkoutReturnReadEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: `checkout-return:${guard.userId}`, limit: 20, windowMs: 10 * 60_000 });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests", retryAfter: gate.retryAfterSec }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(gate.retryAfterSec) } });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind;
  if (kind !== "return" && kind !== "stall_shown") return NextResponse.json({ error: "Invalid kind" }, { status: 400, headers: NO_STORE });

  try {
    const sb = getServiceClient();
    const read = await returnDecisionFor(sb, guard, "/api/checkout-return");
    // A failed read is retryable, never an answer of "no": the browser keeps its marker.
    if (read.error) return NextResponse.json({ ...IDLE, retry: true }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
    const decision = read.decision;
    if (!decision.show) return NextResponse.json(IDLE, { headers: NO_STORE });

    if (kind === "stall_shown") {
      // The prompt lives on /pricing only while the return read is on; one shown row per redirect.
      if (body?.surface !== "pricing") return NextResponse.json({ error: "Invalid surface" }, { status: 400, headers: NO_STORE });
      const seen = await hasEventSince(sb, guard.userId, "checkout_stall_shown", decision.redirectedAt, "/api/checkout-return");
      if (seen === null) return NextResponse.json({ ...IDLE, retry: true }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
      if (seen) return NextResponse.json({ recorded: false, prompt: false }, { headers: NO_STORE });
      const r = await recordEventSafe(sb, { userId: guard.userId, eventType: "checkout_stall_shown", data: sanitizeEventData("checkout_stall_shown", { tier: decision.tier, surface: "pricing" }) });
      return NextResponse.json({ recorded: r.ok, prompt: false }, { headers: NO_STORE });
    }

    // One checkout_return per redirect: a repeat records nothing but still arms the prompt
    // (the first answer may never have reached the page).
    const seen = await hasEventSince(sb, guard.userId, "checkout_return", decision.redirectedAt, "/api/checkout-return");
    if (seen === null) return NextResponse.json({ ...IDLE, retry: true }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
    if (seen) return NextResponse.json({ recorded: false, prompt: true }, { headers: NO_STORE });
    const page = typeof body?.page === "string" ? body.page : "";
    const r = await recordEventSafe(sb, {
      userId: guard.userId,
      eventType: "checkout_return",
      data: sanitizeEventData("checkout_return", { bucket: decision.bucket, tier: decision.tier, page }),
    });
    return NextResponse.json({ recorded: r.ok, prompt: true }, { headers: NO_STORE });
  } catch (err) {
    captureServerError(err, { route: "/api/checkout-return", userId: guard.userId });
    return NextResponse.json(IDLE, { headers: NO_STORE });
  }
});
