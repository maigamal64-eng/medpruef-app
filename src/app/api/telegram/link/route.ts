import { NextRequest, NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dbUnavailableResponse, withDbUnavailable } from "@/lib/db-unavailable-route";
import { captureServerError } from "@/lib/sentry-capture";
import { telegramLinkEnabled } from "@/lib/telegram-link/flag";
import { signTelegramLinkToken, TELEGRAM_LINK_TTL_S } from "@/lib/telegram-link/token";
import { ensureReverseTrial } from "@/lib/pricing-v2/reverse-trial-server";
import { trialClaimEnabled } from "@/lib/trial-claim/flag";
import { claimStatus, forgetClaimNo } from "@/lib/trial-claim/server";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const BOT = "MedPruefBot";

const answeredLinked = new Map<string, number>();
/** True once per account per instance (15 minutes), so polling cannot force a fresh trial check each time. */
function firstLinkedAnswer(userId: string, now = Date.now()): boolean {
  if ((answeredLinked.get(userId) ?? 0) > now) return false;
  if (answeredLinked.size > 5_000) answeredLinked.clear();
  answeredLinked.set(userId, now + 15 * 60_000);
  return true;
}

/**
 * Link Telegram to a signed-in account (a-trial-phone-gate, flag
 * TELEGRAM_LINK_ENABLED, default off: 404 and no read while off).
 *
 * POST: mint a 15-minute signed bot deep link for this account (only while
 *       it has no Telegram). The bot binds the Telegram that presses Start
 *       (src/lib/telegram-link/server.ts).
 * GET:  the prompt polls this after opening Telegram. Once linked it starts
 *       the reverse trial right here, from the learner's own request (so the
 *       network cap counts the learner's network), and for an older account
 *       it returns the claim status fresh (the claim card then offers the
 *       one-tap claim). Never starts anything for an account without Telegram.
 */
async function handlePOST(req: NextRequest) {
  if (!telegramLinkEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const gate = checkRateLimit({ key: rateKey("telegram-link-mint", guard.userId), limit: 10, windowMs: 10 * 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(gate.retryAfterSec) } });
  const sb = getServiceClient();
  const read = await sb.from("users").select("telegram_id, role, tier, email").eq("id", guard.userId).maybeSingle();
  if (read.error) {
    if (isDbUnavailable(read.error)) return dbUnavailableResponse();
    captureServerError(read.error, { route: "/api/telegram/link", phase: "mint", userId: guard.userId });
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
  }
  if (read.data?.telegram_id !== null && read.data?.telegram_id !== undefined) {
    return NextResponse.json({ error: "already_linked", linked: true }, { status: 409, headers: NO_STORE });
  }
  // Reviewer P2: admin, staff and test accounts never get a Telegram login this way.
  if (!read.data || isStaffOrTestAccount(read.data as { role: string | null; tier: string | null; email: string | null })) {
    return NextResponse.json({ error: "not_available" }, { status: 403, headers: NO_STORE });
  }
  const now = new Date();
  const token = signTelegramLinkToken({ userId: guard.userId, now });
  return NextResponse.json({
    url: `https://t.me/${BOT}?start=${token}`,
    expires_at: new Date(now.getTime() + TELEGRAM_LINK_TTL_S * 1000).toISOString(),
  }, { headers: NO_STORE });
}

async function handleGET(req: NextRequest) {
  if (!telegramLinkEnabled()) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const gate = checkRateLimit({ key: rateKey("telegram-link-status", guard.userId), limit: 120, windowMs: 10 * 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(gate.retryAfterSec) } });
  const sb = getServiceClient();
  const read = await sb.from("users")
    .select("telegram_id, created_at, role, tier, tier_expires_at")
    .eq("id", guard.userId).maybeSingle();
  if (read.error) {
    if (isDbUnavailable(read.error)) return dbUnavailableResponse();
    captureServerError(read.error, { route: "/api/telegram/link", phase: "status", userId: guard.userId });
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
  }
  const u = read.data as { telegram_id: unknown; created_at: string | null; role: string | null; tier: string | null; tier_expires_at: string | null } | null;
  const linked = !!u && u.telegram_id !== null && u.telegram_id !== undefined;
  if (!linked || !u) return NextResponse.json({ enabled: true, linked: false }, { headers: NO_STORE });

  // Reviewer P3: the linked branch runs the trial RPC and the claim reads, so it
  // is limited to 10 per 10 minutes per account; the instance's remembered
  // "no" is skipped only on the first linked answer per instance and account.
  const linkedGate = checkRateLimit({ key: rateKey("telegram-link-linked", guard.userId), limit: 10, windowMs: 10 * 60_000 });
  if (!linkedGate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(linkedGate.retryAfterSec) } });
  const fresh = firstLinkedAnswer(guard.userId);
  const trial = await ensureReverseTrial(sb, {
    userId: guard.userId,
    candidate: { createdAt: u.created_at, role: u.role, tier: u.tier, tierExpiresAt: u.tier_expires_at },
    headers: req.headers,
    fresh,
  });
  let claim: { eligible: boolean; reason: string } | null = null;
  if (!trial.active && trialClaimEnabled()) {
    if (fresh) forgetClaimNo(guard.userId);
    try {
      const status = await claimStatus(sb, guard.userId);
      claim = { eligible: status.eligible, reason: status.reason };
    } catch (err) {
      captureServerError(err, { route: "/api/telegram/link", phase: "claim_status", userId: guard.userId });
    }
  }
  return NextResponse.json({
    enabled: true,
    linked: true,
    trial: trial.active ? { ends_at: trial.endsAt, started: trial.started } : null,
    ...(claim ? { claim } : {}),
  }, { headers: NO_STORE });
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
