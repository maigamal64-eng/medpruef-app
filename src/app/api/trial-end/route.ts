import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { checkRateLimit } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { recordEventSafe } from "@/lib/user-events";
import { loadFreeAccess } from "@/lib/free-tier";
import { asPuypExamType, viennaToday } from "@/lib/exam-dates";
import { rowPaidCents, type LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { resolveNamedSitting } from "@/lib/journey/moments";
import { pricingV2Enabled, reverseTrialSince } from "@/lib/pricing-v2/flag";
import { halfYearGuardLive, v2Readiness } from "@/lib/pricing-v2/readiness";
import { isV2Tier } from "@/lib/pricing-v2/offer";
import { trialEndCardEnabled } from "@/lib/trial-end/flag";
import {
  TRIAL_END_CLICK,
  TRIAL_END_SHOWN,
  isSurface,
  isTarget,
  trialEndState,
  trialKindOf,
  type TrialEndState,
} from "@/lib/trial-end/rules";
import { cacheView, noUntil, rememberNo, viewCache, VIEW_TTL_MS } from "@/lib/trial-end/server-cache";
import { cramPartPlanEnabled } from "@/lib/cram-part-plan/flag";
import { CRAM_EXAM_KEY, PART_OF_PRESET, isCramPresetId, latestPartRun } from "@/lib/cram-part-plan";
import { loadPartRuns } from "@/lib/cram-part-plan/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "cache-control": "no-store" };
const SUB_COLUMNS = "tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, crypto_tx_hash, granted_payment_ids, expires_at";

type Db = ReturnType<typeof getServiceClient>;

const NONE = (extra: Record<string, unknown> = {}) => NextResponse.json({ enabled: true, state: "none", ...extra }, { headers: noStore });

async function countEvents(sb: Db, userId: string, type: string, feature?: string): Promise<number> {
  let q = sb.from("user_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("event_type", type);
  if (feature) q = q.eq("event_data->>feature", feature);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Translations the learner used: the server's own record of every new
 * translation, or the client's record of every shown one (cache hits
 * included, consent-gated), whichever is larger. null when unreadable.
 */
async function readTranslations(sb: Db, userId: string): Promise<number | null> {
  try {
    const [server, client] = await Promise.all([
      countEvents(sb, userId, "translation"),
      countEvents(sb, userId, "feature_use", "translate_explanation"),
    ]);
    return Math.max(server, client);
  } catch (err) {
    if (!isDbUnavailable(err)) captureServerError(err, { route: "/api/trial-end", phase: "translations" });
    return null;
  }
}

/**
 * The free sample of the bank is used up: answers in the trial count toward
 * it (a-free-set), so the card must not promise practice that is not there
 * (Lektor E1). null when unreadable.
 */
async function readCapped(sb: Db, userId: string, bank: string): Promise<boolean | null> {
  try {
    return (await loadFreeAccess(sb, userId, bank, { strict: true })).capped;
  } catch (err) {
    if (!isDbUnavailable(err)) captureServerError(err, { route: "/api/trial-end", phase: "free_access" });
    return null;
  }
}

/** The one-time Home card was already shown (server marker; null when unreadable). */
async function readHomeSeen(sb: Db, userId: string): Promise<boolean | null> {
  const { data, error } = await sb.from("user_events").select("id").eq("user_id", userId)
    .eq("event_type", TRIAL_END_SHOWN).eq("event_data->>surface", "home").limit(1);
  if (error) {
    if (!isDbUnavailable(error)) captureServerError(error, { route: "/api/trial-end", phase: "home_seen" });
    return null;
  }
  return (data ?? []).length > 0;
}

/**
 * a-cram-part-plan (CRAM_PART_PLAN_ENABLED): the newest timed SIP4a/SIP5a run
 * of the last 30 days with its subjects below 60 percent, or null (none, or
 * unreadable: the card goes on without the line).
 */
async function readPartRun(sb: Db, userId: string, now: Date): Promise<{ exam_key: string; day: string; weak: string[] } | null> {
  try {
    const run = latestPartRun(await loadPartRuns(sb, userId, now, { limit: 1 }));
    if (!run || !isCramPresetId(run.presetId) || run.weak.length === 0) return null;
    return { exam_key: CRAM_EXAM_KEY[PART_OF_PRESET[run.presetId]], day: run.day, weak: run.weak.map((w) => w.topic) };
  } catch (err) {
    if (!isDbUnavailable(err)) captureServerError(err, { route: "/api/trial-end", phase: "part_run" });
    return null;
  }
}

/**
 * GET /api/trial-end (a-trial-end-decision): the signed-in learner's
 * trial-end state for the "your plan to your sitting" card. {enabled:false}
 * with no read while TRIAL_END_CARD_ENABLED is off. Reads this account's own
 * trials row and subscriptions, its translation counts, the Home marker and
 * its saved sitting; counts and dates only. The plan maths runs on the
 * client from the returned switches (fit.ts is pure). `?surface=home` adds
 * the one-time Home marker (read fresh); other surfaces skip that read.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  if (!trialEndCardEnabled()) return NextResponse.json({ enabled: false }, { headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: `trial-end-read:${guard.userId}`, limit: 60, windowMs: 10 * 60_000 });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests", retryAfter: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  }
  const nowDate = new Date();
  const now = nowDate.getTime();
  if (guard.role === "admin" || guard.tier === "admin") return NONE();
  if ((noUntil.get(guard.userId) ?? 0) > now) return NONE();
  const forHome = req.nextUrl.searchParams.get("surface") === "home";
  // A new purchase, grant or saved exam date is seen at once.
  const access = `${guard.tier}|${guard.tierExpiresAt ?? ""}|${guard.profile?.examDate ?? ""}|${guard.profile?.activeExam ?? ""}`;

  const sb = getServiceClient();
  const cached = viewCache.get(guard.userId);
  if (cached && cached.until > now && cached.access === access) {
    const homeSeen = forHome && cached.body.state === "ended" ? await readHomeSeen(sb, guard.userId) : null;
    return NextResponse.json({ ...cached.body, home_seen: homeSeen }, { headers: noStore });
  }
  const trial = await sb.from("trials").select("kind, expires_at").eq("user_id", guard.userId).maybeSingle();
  if (trial.error) throw trial.error;
  const row = trial.data as { kind?: string | null; expires_at?: string | null } | null;
  if (!row || row.kind !== "reverse" || typeof row.expires_at !== "string") {
    rememberNo(guard.userId, now);
    return NONE();
  }
  const subs = await sb.from("subscriptions").select(SUB_COLUMNS).eq("user_id", guard.userId);
  if (subs.error) throw subs.error;
  const everPaid = ((subs.data ?? []) as LearnerSubscriptionRow[]).some((s) => rowPaidCents(s) > 0);
  const state: TrialEndState = trialEndState({
    trialEndsAt: row.expires_at,
    everPaid,
    user: { role: guard.role, tier: guard.tier, tierExpiresAt: guard.tierExpiresAt },
    now: nowDate,
  });
  if (everPaid) rememberNo(guard.userId, now);
  if (state === "none") return NONE();

  const profile = guard.profile;
  const bank = asPuypExamType(profile?.activeExam ?? null) ?? "kenntnispruefung";
  const named = resolveNamedSitting({ examDate: profile?.examDate ?? null, activeExam: profile?.activeExam ?? null }, nowDate);
  // Only a sitting still ahead can be bought for; a past one is asked again.
  const sitting = named && named.bank && named.date_end >= viennaToday(nowDate)
    ? { bank: named.bank, date: named.date, lastDay: named.date_end }
    : null;
  const [translations, capped, homeSeen, partRun] = await Promise.all([
    readTranslations(sb, guard.userId),
    readCapped(sb, guard.userId, bank),
    forHome && state === "ended" ? readHomeSeen(sb, guard.userId) : Promise.resolve(null),
    cramPartPlanEnabled() ? readPartRun(sb, guard.userId, nowDate) : Promise.resolve(null),
  ]);

  const body: Record<string, unknown> = {
    enabled: true,
    state,
    ends_at: row.expires_at,
    trial: trialKindOf(profile?.createdAt ?? null, reverseTrialSince()),
    exam: bank,
    sitting,
    translations,
    capped,
    v2: pricingV2Enabled(),
    guard: halfYearGuardLive(),
    ready: v2Readiness(),
    // Only while CRAM_PART_PLAN_ENABLED is on: off, the body is unchanged.
    ...(partRun ? { part_run: partRun } : {}),
  };
  const trialEnd = Date.parse(row.expires_at);
  cacheView(guard.userId, access, body, state === "last_day" ? Math.min(now + VIEW_TTL_MS, trialEnd) : now + VIEW_TTL_MS);
  // home_seen: null = not asked or unknown; the client shows the Home card only on a definite false.
  return NextResponse.json({ ...body, home_seen: homeSeen }, { headers: noStore });
});

/**
 * POST /api/trial-end {event: "shown"|"click", surface, plan?, target?, exam?, trial?}
 * Records trial_end_card_shown / trial_end_card_click in user_events with
 * bounded enum fields only, for the Monday scoreboard. Written by the server
 * so the one-time Home marker holds without analytics consent. A second
 * Home "shown" is not written. 404 while the flag is off.
 */
export const POST = withDbUnavailable(async (req: NextRequest) => {
  if (!trialEndCardEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: `trial-end-event:${guard.userId}`, limit: 30, windowMs: 10 * 60_000 });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests", retryAfter: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const event = body?.event;
  if ((event !== "shown" && event !== "click") || !isSurface(body?.surface)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400, headers: noStore });
  }
  const data: Record<string, string> = { surface: body.surface };
  if (body.plan === "none" || isV2Tier(body.plan)) data.plan = body.plan as string;
  const exam = asPuypExamType(body.exam);
  if (exam) data.exam = exam;
  if (body.trial === "auto" || body.trial === "claim") data.trial = body.trial;
  if (event === "click") {
    if (!isTarget(body.target)) return NextResponse.json({ error: "Invalid target" }, { status: 400, headers: noStore });
    data.target = body.target;
  }
  const sb = getServiceClient();
  if (event === "shown" && data.surface === "home" && (await readHomeSeen(sb, guard.userId)) !== false) {
    return NextResponse.json({ ok: true, recorded: false }, { headers: noStore });
  }
  const result = await recordEventSafe(sb, { userId: guard.userId, eventType: event === "shown" ? TRIAL_END_SHOWN : TRIAL_END_CLICK, data });
  return NextResponse.json({ ok: true, recorded: result.ok }, { headers: noStore });
});
