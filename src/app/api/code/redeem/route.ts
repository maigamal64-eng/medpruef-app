import { NextResponse, type NextRequest } from "next/server";
import { forgetGuardUser, requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { recordEventSafe } from "@/lib/user-events";
import { readFreeCreditConfig, normalizeCampaignCode } from "@/lib/mentor/credits/free-credits";
import { redeemCampaignCode } from "@/lib/mentor/credits/campaign";
import { claimReferralCode } from "@/lib/referral-claim";
import { codeAtSignupServerEnabled, normalizeTypedCode, type CodeFailure } from "@/lib/code-entry";
import { seedSeatsReady } from "@/lib/seed-seats";
import { readCodeKind, redeemSeatCode, type SeatReason } from "@/lib/seed-seats/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Code guessing: 5 tries per learner and 20 per address in 10 minutes (as the credit-code route). */
const USER_LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const IP_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
/** A typed referral code must come from a new account (the credit codes' own window applies to campaigns). */
const REFERRAL_MAX_ACCOUNT_AGE_DAYS = 14;

const SOURCES = new Set(["register", "landing", "home"]);
const NO_STORE = { "cache-control": "no-store" };

/**
 * POST /api/code/redeem {code, source}: the code front door
 * (a-code-front-door). One typed code, the server decides the kind: a campaign
 * credit code first (mentor_redeem_campaign_code, the existing function), then
 * a personal referral code. 404 while CODE_AT_SIGNUP_ENABLED is off.
 *
 * Neutral reply: an unknown, paused, ended or not-yet-open code, a campaign
 * feature that is off and an unknown referral code all answer
 * {ok:false, reason:"not_active"} (the same line as /gratis), so the route
 * never confirms that a code exists. The kind is returned only on success and
 * recorded on the user_events row `code_redeemed` {kind, code, source}.
 * a-seed-seats (merged in a-release-int-5): while seats are ready the code's
 * kind is read first and a seat code goes to mentor_redeem_seat_code, as in
 * /api/mentor/campaign/redeem. Code-level refusals of a seat code read
 * not_active like every other code; the seat's own account rules (never paid,
 * already Pro, one seat per person, confirmed identity) keep their seat lines.
 */
/** Seat refusal -> front-door failure (unknown, paused, ended and capped codes read alike). */
function seatFailure(reason: SeatReason): CodeFailure | "unavailable_db" {
  switch (reason) {
    case "unknown_code": case "inactive": case "not_started": case "expired": case "cap_reached": case "daily_cap": return "not_active";
    case "already_redeemed": return "already_used";
    case "unverified": return "seat_unverified";
    case "paid_before": case "already_pro": case "identity_used": case "account_too_old": case "banned": case "invalid_args": return reason;
    default: return "unavailable_db";
  }
}
export async function POST(req: NextRequest) {
  if (!codeAtSignupServerEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const ip = checkRateLimit({ key: rateKey("code-redeem-ip", callerIp(req)), ...IP_LIMIT });
  const user = checkRateLimit({ key: rateKey("code-redeem-user", guard.userId), ...USER_LIMIT });
  if (!ip.allowed || !user.allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited", retry_after_seconds: Math.max(ip.retryAfterSec, user.retryAfterSec) }, { status: 429, headers: NO_STORE });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown; source?: unknown } | null;
  const code = normalizeTypedCode(body?.code);
  if (!code) return NextResponse.json({ ok: false, reason: "invalid_args" satisfies CodeFailure }, { status: 400, headers: NO_STORE });
  const source = typeof body?.source === "string" && SOURCES.has(body.source) ? body.source : "register";
  const sb = getServiceClient();
  const unavailable = (phase: string, err?: unknown) => {
    captureServerError(err instanceof Error ? err : new Error(`code redeem failed: ${phase}`), { route: "/api/code/redeem", phase, userId: guard.userId });
    return NextResponse.json({ ok: false, reason: "unavailable" satisfies CodeFailure }, { status: 503, headers: { ...NO_STORE, "retry-after": "30" } });
  };
  const success = async (kind: "campaign" | "referral" | "seat", extra: Record<string, unknown>) => {
    // A referral code has no hyphens: record it the way the claim stores it, so a count per code is one row.
    const recorded = (kind === "referral" ? code.replace(/-/g, "") : code).toLowerCase();
    await recordEventSafe(sb, { userId: guard.userId, eventType: "code_redeemed", data: { kind, code: recorded, source, duplicate: extra.duplicate === true } });
    return NextResponse.json({ ok: true, kind, ...extra }, { headers: NO_STORE });
  };
  const fail = (reason: CodeFailure, status = 409) => NextResponse.json({ ok: false, reason }, { status, headers: NO_STORE });

  const fc = readFreeCreditConfig();
  const campaignCode = normalizeCampaignCode(code);

  // 0) Seed seat code (a-seed-seats), only while seats are ready.
  if (seedSeatsReady() && campaignCode) {
    let kind: Awaited<ReturnType<typeof readCodeKind>>;
    try {
      kind = await readCodeKind(sb, campaignCode);
    } catch (err) {
      return unavailable("seat_kind", err);
    }
    if (kind === "seat") {
      const r = await redeemSeatCode(sb, guard.userId, campaignCode, "landing");
      if (r.ok) {
        // The guard caches tier reads per instance: the new Pro must show at once.
        forgetGuardUser(guard.userId);
        return success("seat", { duplicate: r.duplicate, credits: r.credits, expires_at: r.seatEndsAt });
      }
      const f = seatFailure(r.reason);
      if (f === "unavailable_db") return unavailable(`seat_${r.reason}`);
      return fail(f, f === "invalid_args" ? 400 : 409);
    }
  }

  // 1) Campaign credit code (hyphens kept: TG-SPT).
  // An account-level refusal comes before the code lookup in SQL, so it says nothing about the code:
  // the learner may still hold a referral code, which is tried next and wins if it exists.
  let accountReason: "unverified" | "account_too_old" | "banned" | null = null;
  if (fc.campaignEnabled && campaignCode) {
    const r = await redeemCampaignCode(sb, guard.userId, campaignCode, "landing", fc.campaignAccountMaxAgeDays);
    if (r.ok) return success("campaign", { duplicate: r.duplicate, credits: r.credits, expires_at: r.expiresAt });
    switch (r.reason) {
      case "unknown_code": break; // not a campaign code: try a referral code below
      // Every reason that is only reachable for an existing code reads alike (no code enumeration).
      case "inactive": case "not_started": case "expired": case "cap_reached": case "daily_cap": return fail("not_active");
      case "already_redeemed": return fail("already_used");
      case "unverified": case "account_too_old": case "banned": accountReason = r.reason; break;
      case "invalid_args": return fail("invalid_args", 400);
      default: return unavailable(r.reason);
    }
  }

  // 2) Personal referral code (hyphens dropped by the claim; codes have none).
  const c = await claimReferralCode(sb, guard.userId, code, { maxAccountAgeDays: REFERRAL_MAX_ACCOUNT_AGE_DAYS });
  switch (c.status) {
    case "ok": case "deduped": return success("referral", { duplicate: c.status === "deduped" });
    case "already": return fail("already_used");
    case "self": return fail("own_code");
    case "too_old": return fail("account_too_old");
    case "invalid": case "not_found": return accountReason ? fail(accountReason) : fail("not_active");
    default: return unavailable("referral_claim");
  }
}
