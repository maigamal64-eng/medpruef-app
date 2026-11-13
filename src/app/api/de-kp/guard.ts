import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser, isPaidAccess, type GuardSuccess } from "@/lib/auth-guard";
import { deKpEnabled } from "@/lib/de-kp";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

/** Per signed user, across every KP-DE route: generous for a live run, a wall for scraping the bank. */
export const DE_KP_RATE_LIMIT = 120;
export const DE_KP_RATE_WINDOW_MS = 60_000;

/**
 * Shared guard for every KP-DE route (spec section 5). Same order as guardKaf:
 * requireUser, then the dark flag (404 DE_KP_DISABLED keeps the feature
 * invisible), then a per-user rate limit (429), then Pro (403 PRO_REQUIRED) unless the route allows the free case.
 * With allowFree the caller must still run `caseAccessError` once it knows the
 * case row. The user id always comes from the guard, never from a body.
 */
export type DeKpGate = { guard: GuardSuccess; paid: boolean } | { error: NextResponse };

export async function guardDeKp(req: NextRequest, opts: { allowFree?: boolean } = {}): Promise<DeKpGate> {
  const guard = await requireUser(req);
  if ("error" in guard) return { error: guard.error };
  if (!deKpEnabled()) return { error: NextResponse.json({ error: "Not found", code: "DE_KP_DISABLED" }, { status: 404 }) };
  const gate = checkRateLimit({ key: rateKey("de-kp", guard.userId), limit: DE_KP_RATE_LIMIT, windowMs: DE_KP_RATE_WINDOW_MS });
  if (!gate.allowed) {
    return { error: NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(gate, { limit: DE_KP_RATE_LIMIT }) }) };
  }
  const paid = isPaidAccess(guard);
  if (!paid && !opts.allowFree) return { error: proRequired() };
  return { guard, paid };
}

export function proRequired(): NextResponse {
  return NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 });
}

/** The free case is open to every signed-in tier; every other case needs paid access. */
export function caseAccessError(paid: boolean, c: { is_free: boolean }): NextResponse | null {
  return paid || c.is_free === true ? null : proRequired();
}

export function unavailableResponse(): NextResponse {
  return NextResponse.json({ error: "Cases unavailable", code: "DE_KP_UNAVAILABLE" }, { status: 503 });
}

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;
