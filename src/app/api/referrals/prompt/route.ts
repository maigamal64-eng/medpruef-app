import { NextRequest, NextResponse } from "next/server";
import { isPaidAccess, requireUser, type GuardSuccess } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { buildReferralLink } from "@/lib/referrals";
import { ensureReferralCode } from "@/lib/referral-code-server";
import { referralMentorCreditsOffered } from "@/lib/referral-mentor-credits";
import { isReferralExamRewardEnabled } from "@/lib/referral-exam-reward";
import { hasLivePaidSubscription } from "@/lib/offline-entitlement";
import type { SubscriptionLike } from "@/lib/admin/money-rules";
import {
  REFERRAL_PROMPT_DISMISSED_EVENT,
  REFERRAL_PROMPT_INTERVAL_MS,
  REFERRAL_PROMPT_READ_DAYS,
  REFERRAL_PROMPT_ROW_CAP,
  REFERRAL_PROMPT_SHOWN_EVENT,
  referralMoment,
  referralPromptCadence,
  referralPromptFlag,
  shownWindowStart,
  type AnswerRow,
  type ReferralMoment,
} from "@/lib/referral-prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };
const OFF = { enabled: false, show: false } as const;

type Db = ReturnType<typeof getServiceClient>;

function switchedOff(): boolean {
  return !referralPromptFlag(process.env) || !isReferralExamRewardEnabled();
}

/** Pro access and enrolled in the referral program: the cheap check before any read. */
function eligibleAccount(guard: GuardSuccess): boolean {
  return guard.profile?.referralsEnabled === true && isPaidAccess(guard);
}

/**
 * Paying means money behind the access, the same rule as "paying" in
 * money-rules and the whole-bank pack (offline-entitlement): a live
 * subscriptions row with a positive payment. A trial, a seed seat, a referral
 * reward or a comped grant is Pro access but not paying. Admins pass (smoke
 * tests).
 */
async function payingLearner(sb: Db, guard: GuardSuccess, now: Date): Promise<boolean> {
  if (guard.role === "admin") return true;
  const { data, error } = await sb
    .from("subscriptions")
    .select("user_id, tier, status, payment_provider, amount_cents, provider_payment_id, granted_payment_ids, expires_at")
    .eq("user_id", guard.userId)
    .eq("status", "active")
    .limit(50);
  if (error) throw error;
  return hasLivePaidSubscription((data ?? []) as SubscriptionLike[], now);
}

function limited(userId: string, kind: "read" | "write"): NextResponse | null {
  const gate = checkRateLimit({ key: rateKey(`referral-prompt-${kind}`, userId), limit: kind === "read" ? 30 : 10, windowMs: 60 * 60_000 });
  if (gate.allowed) return null;
  return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec), ...NO_STORE } });
}

async function newestEvent(sb: Db, userId: string, eventType: string, since: Date | null): Promise<string | null> {
  let q = sb.from("user_events").select("created_at").eq("user_id", userId).eq("event_type", eventType);
  if (since) q = q.gte("created_at", since.toISOString());
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { created_at?: string | null } | undefined;
  return row?.created_at ?? null;
}

/** Dismissed for good, or shown in the last 14 days (with the time it may show again). */
async function cadenceState(sb: Db, userId: string, now: Date) {
  const dismissedAt = await newestEvent(sb, userId, REFERRAL_PROMPT_DISMISSED_EVENT, null);
  if (dismissedAt) return { blocked: referralPromptCadence({ dismissed: true, lastShownAt: null, now }), nextAt: null };
  const lastShownAt = await newestEvent(sb, userId, REFERRAL_PROMPT_SHOWN_EVENT, shownWindowStart(now));
  const blocked = referralPromptCadence({ dismissed: false, lastShownAt, now });
  const nextAt = blocked && lastShownAt ? new Date(Date.parse(lastShownAt) + REFERRAL_PROMPT_INTERVAL_MS).toISOString() : null;
  return { blocked, nextAt };
}

async function moment(sb: Db, userId: string, now: Date): Promise<ReferralMoment | null> {
  const since = new Date(now.getTime() - REFERRAL_PROMPT_READ_DAYS * 86_400_000).toISOString();
  const { data, error } = await sb.from("answer_history").select("question_id, is_correct, created_at").eq("user_id", userId)
    .gte("created_at", since).order("created_at", { ascending: false }).limit(REFERRAL_PROMPT_ROW_CAP);
  if (error) throw error;
  return referralMoment((data ?? []) as AnswerRow[], now);
}

/**
 * GET /api/referrals/prompt (a-referral-prompt-1029)
 *
 * May Home show the referral prompt to this learner now? Writes nothing except
 * minting a missing referral code when the answer is yes. Off
 * (REFERRAL_PROMPT_ENABLED not "true" or the exam reward off): {enabled:false}
 * with no read at all. Without Pro access or outside the referral program:
 * {enabled:false} after the session read; Pro access without a live paid
 * subscription (trial, seat, reward, comp): {enabled:false} after one
 * subscriptions read. Otherwise {show:false, reason}
 * when dismissed for good ("dismissed"), shown in the last 14 days
 * ("shown_recently", with nextAt) or without a good moment ("no_moment"), else
 * {show:true, moment, link, mentorCredits}.
 */
async function handleGET(req: NextRequest) {
  if (switchedOff()) return NextResponse.json(OFF, { headers: NO_STORE });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!eligibleAccount(guard)) return NextResponse.json(OFF, { headers: NO_STORE });
  const slow = limited(guard.userId, "read");
  if (slow) return slow;

  const sb = getServiceClient();
  const now = new Date();
  if (!(await payingLearner(sb, guard, now))) return NextResponse.json(OFF, { headers: NO_STORE });
  const lastShownAt = await cadenceState(sb, guard.userId, now);
  const blocked = lastShownAt.blocked;
  if (blocked) {
    return NextResponse.json(
      { enabled: true, show: false, reason: blocked, ...(lastShownAt.nextAt ? { nextAt: lastShownAt.nextAt } : {}) },
      { headers: NO_STORE },
    );
  }
  const found = await moment(sb, guard.userId, now);
  if (!found) return NextResponse.json({ enabled: true, show: false, reason: "no_moment" }, { headers: NO_STORE });

  const { data: me, error: meErr } = await sb.from("users").select("referral_code").eq("id", guard.userId).maybeSingle();
  if (meErr) throw meErr;
  if (!me) return NextResponse.json({ error: "User lookup failed" }, { status: 500, headers: NO_STORE });
  const ensured = await ensureReferralCode(sb, guard.userId, me.referral_code as string | null);
  if (!ensured.ok) {
    if (ensured.reason === "update_failed") console.error("[referrals/prompt] code update", ensured.error);
    return NextResponse.json({ error: "Could not prepare the referral link" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(
    { enabled: true, show: true, moment: found, link: buildReferralLink(ensured.code), mentorCredits: referralMentorCreditsOffered() },
    { headers: NO_STORE },
  );
}

/**
 * POST /api/referrals/prompt {action:"shown", moment} | {action:"dismissed"}
 *
 * "shown": the card is about to render. Re-checks the cadence and stores one
 * user_events row referral_prompt_shown {moment}; {show:true} only then.
 * "dismissed": "Nicht mehr fragen", stored once as referral_prompt_dismissed;
 * the prompt never comes back for this account on any device.
 */
async function handlePOST(req: NextRequest) {
  if (switchedOff()) return NextResponse.json(OFF, { headers: NO_STORE });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!eligibleAccount(guard)) return NextResponse.json(OFF, { headers: NO_STORE });
  const slow = limited(guard.userId, "write");
  if (slow) return slow;

  let body: { action?: unknown; moment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const sb = getServiceClient();
  const now = new Date();
  if (!(await payingLearner(sb, guard, now))) return NextResponse.json(OFF, { headers: NO_STORE });

  if (body?.action === "dismissed") {
    const already = await newestEvent(sb, guard.userId, REFERRAL_PROMPT_DISMISSED_EVENT, null);
    if (!already) {
      const { error } = await sb.from("user_events").insert({ user_id: guard.userId, event_type: REFERRAL_PROMPT_DISMISSED_EVENT, event_data: { surface: "home" } });
      if (error) throw error;
    }
    return NextResponse.json({ enabled: true, show: false, reason: "dismissed" }, { headers: NO_STORE });
  }
  if (body?.action !== "shown") return NextResponse.json({ error: "Invalid action" }, { status: 400, headers: NO_STORE });
  const m = body.moment === "strong_session" || body.moment === "fixed_mistakes" ? body.moment : null;
  if (!m) return NextResponse.json({ error: "Invalid moment" }, { status: 400, headers: NO_STORE });

  const { blocked } = await cadenceState(sb, guard.userId, now);
  if (blocked) return NextResponse.json({ enabled: true, show: false, reason: blocked }, { headers: NO_STORE });
  const { error } = await sb.from("user_events").insert({ user_id: guard.userId, event_type: REFERRAL_PROMPT_SHOWN_EVENT, event_data: { surface: "home", moment: m } });
  if (error) throw error;
  return NextResponse.json({ enabled: true, show: true }, { headers: NO_STORE });
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
