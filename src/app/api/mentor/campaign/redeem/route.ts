import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { redeemCampaignCode, type RedeemVia } from "@/lib/mentor/credits/campaign";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Code guessing: 5 tries per learner and 20 per address in 10 minutes. */
const USER_LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const IP_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

/**
 * POST /api/mentor/campaign/redeem {code, via}: one campaign code per account
 * (a-free-credit-hooks). 404 while MENTOR_CAMPAIGN_CODES_ENABLED is off.
 * Never a GET: the landing page posts once after sign-in, Settings on submit.
 * A repeat of the same code is an idempotent 200 (duplicate: true).
 */
export async function POST(req: NextRequest) {
  const fc = readFreeCreditConfig();
  if (!fc.campaignEnabled) return NextResponse.json({ error: "not_found" }, { status: 404 });
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
  const r = await redeemCampaignCode(sb, guard.userId, body?.code, via, fc.campaignAccountMaxAgeDays);
  if (r.ok) return NextResponse.json({ ok: true, duplicate: r.duplicate, credits: r.credits, expires_at: r.expiresAt, code: r.code }, { headers: { "cache-control": "no-store" } });
  if (r.reason === "db_error" || r.reason === "missing_function" || r.reason === "grant_failed") {
    captureServerError(new Error(`campaign redeem failed: ${r.reason}`), { route: "/api/mentor/campaign/redeem", userId: guard.userId });
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503, headers: { "retry-after": "30" } });
  }
  // Unknown, paused, ended and not-started codes answer alike (no code enumeration).
  const reason = r.reason === "inactive" || r.reason === "expired" || r.reason === "not_started" || r.reason === "unknown_code" ? "not_active" : r.reason;
  return NextResponse.json({ ok: false, reason }, { status: reason === "invalid_args" ? 400 : 409 });
}
