import { NextResponse, type NextRequest } from "next/server";
import { forgetGuardUser, requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { redeemCampaignCode, type RedeemVia } from "@/lib/mentor/credits/campaign";
import { SEAT_MAX_ACCOUNT_AGE_DAYS, seedSeatsReady } from "@/lib/seed-seats";
import { readCodeKind, redeemSeatCode } from "@/lib/seed-seats/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Code guessing: 5 tries per learner and 20 per address in 10 minutes. */
const USER_LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const IP_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

const NOT_ACTIVE = new Set(["inactive", "expired", "not_started", "unknown_code"]);
const UNAVAILABLE = new Set(["db_error", "missing_function", "grant_failed"]);

/**
 * POST /api/mentor/campaign/redeem {code, via}: one campaign code per account
 * (a-free-credit-hooks). 404 while MENTOR_CAMPAIGN_CODES_ENABLED and seed
 * seats (SEED_SEATS_ENABLED with the Mentor open to Pro, a-seed-seats) are
 * both off. Never a GET: the landing page posts once after sign-in, Settings
 * on submit. A repeat of the same code is an idempotent 200 (duplicate: true).
 * While seats are off this route is byte for byte the credit-code route (a
 * seat code is refused by the credit function as unknown). While they are on
 * it reads the code's kind once and sends a seat code to
 * mentor_redeem_seat_code (30 Pro days plus the code's credits).
 */
export async function POST(req: NextRequest) {
  const fc = readFreeCreditConfig();
  const seats = seedSeatsReady();
  if (!fc.campaignEnabled && !seats) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const ip = checkRateLimit({ key: rateKey("campaign-redeem-ip", callerIp(req)), ...IP_LIMIT });
  const user = checkRateLimit({ key: rateKey("campaign-redeem-user", guard.userId), ...USER_LIMIT });
  if (!ip.allowed || !user.allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited", retry_after_seconds: Math.max(ip.retryAfterSec, user.retryAfterSec) }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown; via?: unknown } | null;
  const via: RedeemVia = body?.via === "settings" ? "settings" : "landing";
  const sb = getServiceClient();

  if (seats) {
    let kind: Awaited<ReturnType<typeof readCodeKind>>;
    try {
      kind = await readCodeKind(sb, body?.code);
    } catch (err) {
      captureServerError(err, { route: "/api/mentor/campaign/redeem", phase: "seat_kind", userId: guard.userId });
      return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503, headers: { "retry-after": "30" } });
    }
    if (kind === "seat") {
      const r = await redeemSeatCode(sb, guard.userId, body?.code, via);
      if (r.ok) {
        // The guard caches tier reads per instance: the new Pro must show at once.
        forgetGuardUser(guard.userId);
        return NextResponse.json(
          { ok: true, kind: "seat", duplicate: r.duplicate, credits: r.credits, seat_ends_at: r.seatEndsAt, expires_at: r.seatEndsAt, code: r.code },
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (UNAVAILABLE.has(r.reason)) {
        captureServerError(new Error(`seat redeem failed: ${r.reason}`), { route: "/api/mentor/campaign/redeem", phase: "seat", userId: guard.userId });
        return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503, headers: { "retry-after": "30" } });
      }
      const reason = NOT_ACTIVE.has(r.reason) ? "not_active" : r.reason;
      // No kind on a refusal: a paused or ended seat code answers like an unknown code.
      return NextResponse.json({ ok: false, reason, ...(reason === "not_active" ? {} : { max_age_days: SEAT_MAX_ACCOUNT_AGE_DAYS }) }, { status: reason === "invalid_args" ? 400 : 409 });
    }
    // Not a seat code: with credit codes off it is simply not active.
    if (!fc.campaignEnabled) return NextResponse.json({ ok: false, reason: "not_active" }, { status: 409 });
  }

  const r = await redeemCampaignCode(sb, guard.userId, body?.code, via, fc.campaignAccountMaxAgeDays);
  if (r.ok) return NextResponse.json({ ok: true, duplicate: r.duplicate, credits: r.credits, expires_at: r.expiresAt, code: r.code }, { headers: { "cache-control": "no-store" } });
  if (UNAVAILABLE.has(r.reason)) {
    captureServerError(new Error(`campaign redeem failed: ${r.reason}`), { route: "/api/mentor/campaign/redeem", userId: guard.userId });
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503, headers: { "retry-after": "30" } });
  }
  // Unknown, paused, ended and not-started codes answer alike (no code enumeration).
  const reason = NOT_ACTIVE.has(r.reason) ? "not_active" : r.reason;
  return NextResponse.json({ ok: false, reason, ...(seats && reason !== "not_active" ? { max_age_days: fc.campaignAccountMaxAgeDays } : {}) }, { status: reason === "invalid_args" ? 400 : 409 });
}
