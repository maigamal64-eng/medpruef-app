import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dbUnavailableResponse, withDbUnavailable } from "@/lib/db-unavailable-route";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";
import { trialClaimEnabled } from "@/lib/trial-claim/flag";
import { verifyClaimToken, type ClaimTokenResult } from "@/lib/trial-claim/token";
import { ClaimReadError, claimStatus, claimTrial } from "@/lib/trial-claim/server";
import { telegramLinkEnabled } from "@/lib/telegram-link/flag";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/trial/claim: the one-time 3-day full access for existing accounts
 * (a-reverse-trial-claim, flag TRIAL_CLAIM_ENABLED, default off). Rules:
 * src/lib/trial-claim/rules.ts.
 *
 * GET  [x-claim-token]    status for the Home card and the claim page
 *                         (eligible, reason, link state). Grants nothing.
 *                         The link token travels in a header, never in the
 *                         API URL that logs keep.
 * POST {token?}           claims. The Home card sends no token (the signed
 *                         session is the account); the mail link page sends
 *                         its token, which must belong to the same account
 *                         and must not have expired.
 *
 * Never creates a checkout session and never calls Whop. While the flag is
 * off: GET answers enabled:false without a database read, POST 404.
 */

const NO_STORE = { "Cache-Control": "no-store" };
type LinkState = "valid" | "expired" | "invalid" | "other_account" | "unconfigured";

function linkState(token: ClaimTokenResult, userId: string): LinkState {
  if (!token.ok) return token.error;
  return token.userId === userId.toLowerCase() ? "valid" : "other_account";
}

function failure(err: unknown, phase: string, userId: string) {
  const cause = err instanceof ClaimReadError ? err.cause : err;
  if (isDbUnavailable(cause)) return dbUnavailableResponse();
  captureServerError(cause, { route: "/api/trial/claim", phase, userId });
  // Before 20270103090000 is applied the trials columns do not exist: unavailable, never a false "no".
  return NextResponse.json({ error: "The trial cannot be claimed right now.", code: "CLAIM_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
}

async function handleGET(req: NextRequest) {
  if (!trialClaimEnabled()) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: rateKey("trial-claim-get", guard.userId), limit: 30, windowMs: 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  const raw = req.headers.get("x-claim-token");
  const token = raw ? verifyClaimToken(raw) : null;
  const link = token ? linkState(token, guard.userId) : undefined;
  try {
    const status = await claimStatus(getServiceClient(), guard.userId, {
      tokenEmailKey: token?.ok && link === "valid" ? token.emailKey : null,
    });
    return NextResponse.json({
      enabled: true,
      days: REVERSE_TRIAL_DAYS,
      eligible: status.eligible,
      reason: status.reason,
      ends_at: status.endsAt,
      // a-trial-phone-gate: the card and page offer "Telegram verbinden" only while the link path is on.
      ...(status.reason === "telegram_required" && telegramLinkEnabled() ? { telegram_link: true } : {}),
      ...(link ? { link } : {}),
    }, { headers: NO_STORE });
  } catch (err) {
    return failure(err, "status", guard.userId);
  }
}

async function handlePOST(req: NextRequest) {
  if (!trialClaimEnabled()) return NextResponse.json({ error: "Not available.", code: "TRIAL_CLAIM_OFF" }, { status: 404, headers: NO_STORE });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: rateKey("trial-claim-post", guard.userId), limit: 5, windowMs: 10 * 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const rawToken = body && typeof body === "object" ? (body as { token?: unknown }).token : undefined;
  let tokenEmailKey: string | null = null;
  if (rawToken !== undefined && rawToken !== null && rawToken !== "") {
    const token = verifyClaimToken(rawToken);
    const state = linkState(token, guard.userId);
    if (state === "unconfigured") return NextResponse.json({ error: "Links are not available.", code: "LINK_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
    if (state === "expired") return NextResponse.json({ error: "This link has expired.", code: "LINK_EXPIRED" }, { status: 410, headers: NO_STORE });
    if (state === "invalid") return NextResponse.json({ error: "This link is not valid.", code: "LINK_INVALID" }, { status: 400, headers: NO_STORE });
    if (state === "other_account") return NextResponse.json({ error: "This link belongs to another account.", code: "LINK_OTHER_ACCOUNT" }, { status: 403, headers: NO_STORE });
    tokenEmailKey = token.ok ? token.emailKey : null;
  }

  try {
    const result = await claimTrial(getServiceClient({ fastFail: false }), {
      userId: guard.userId,
      tokenEmailKey,
      source: tokenEmailKey !== null || rawToken ? "link" : "home",
      headers: req.headers,
    });
    if (result.claimed) {
      return NextResponse.json({ claimed: true, already: result.already, ends_at: result.endsAt, days: REVERSE_TRIAL_DAYS }, { headers: NO_STORE });
    }
    const status = result.reason === "ip_limit" ? 429 : 409;
    return NextResponse.json({ claimed: false, reason: result.reason, code: "NOT_ELIGIBLE" }, { status, headers: NO_STORE });
  } catch (err) {
    return failure(err, "claim", guard.userId);
  }
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
