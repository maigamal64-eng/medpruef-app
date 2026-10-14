/**
 * Referral mentor credits (a-mentor-open, 14 Oct 2026; ai-cost-2026-10-14
 * recommendation B + D). Flag REFERRAL_MENTOR_CREDITS_ENABLED, default OFF:
 * with the flag off nothing here reads or writes anything.
 *
 * The referrer gets 50 mentor credits as its own lot when the person they
 * referred pays for the first time:
 *   - trigger: a Pro grant on a Whop charge with amount_cents > 0 (the EUR 0
 *     card-trial start never counts; the EUR 19 trial conversion does). Called
 *     from the webhook grant and both /api/whop/checkout/verify grant paths.
 *     Mentor package purchases have their own branch and are not a trigger.
 *   - first charge only: no other paid entry in any of the referee's
 *     subscriptions rows (granted_payment_ids, or a positive amount on a row
 *     of another payment);
 *   - new account: users.created_at at most 24 hours before the referral
 *     claim, and no subscriptions row created before the claim;
 *   - at most 3 such lots per referrer per calendar month (Europe/Vienna);
 *   - the referrer exists and is not banned; not a self-referral.
 * Lot: package referral_reward, source 'referral_reward', source_id
 * 'first_charge:<referral id>' (the exam reward owns the bare referral id),
 * 250,000 micro-USD, expiring 30 days after the grant. The referee's payment
 * id is NOT stored on the lot: mentor_whop_lookup matches lots by
 * whop_payment_id, which would route the referee's Pro refund into the mentor
 * branch and skip the Pro revoke. The link lives in the audit row instead.
 *
 * If the referrer cannot open the mentor under the current
 * MENTOR_ACCESS_SCOPE, the lot is still granted (the credits wait) and the
 * row says referrer_not_admitted.
 *
 * Audit: one user_events row per decision on the referrer
 * (event_type referral_mentor_credits; outcome granted | skipped | clawed_back),
 * shown in the admin learner timeline. Only the first paid charge can ever
 * qualify, so a decision is final per referral: later charges and retries
 * write nothing. A transient failure writes nothing and is reported.
 *
 * Refund or dispute of that charge: mentor_clawback on the lot (idempotent;
 * a non-payment lot loses its unspent part, no debt).
 *
 * Accepted limits: two different referees paying in the same second can let
 * one referrer pass the monthly cap once (at most one extra lot, EUR 0.22).
 * A refund that arrives before the payment's grant is caught only when the
 * subscriptions row already says refunded.
 */

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_MICRO_USD } from "@/lib/mentor/config";
import { rpcClawback, rpcGrantCredits } from "@/lib/mentor/credits/db";

type Db = Pick<SupabaseClient, "from" | "rpc">;
type Env = Record<string, string | undefined>;

export const REFERRAL_MENTOR_CREDITS_ENV = "REFERRAL_MENTOR_CREDITS_ENABLED";
export const REFERRAL_MENTOR_CREDITS = 50;
export const REFERRAL_MENTOR_CREDIT_MICRO = REFERRAL_MENTOR_CREDITS * CREDIT_MICRO_USD;
export const REFERRAL_MENTOR_EXPIRY_DAYS = 30;
export const REFERRAL_MENTOR_MONTHLY_CAP = 3;
export const REFERRAL_NEW_ACCOUNT_WINDOW_MS = 24 * 3600_000;
/** Clock skew allowed when an account row is stamped just after the claim. */
const CLAIM_SKEW_MS = 5 * 60_000;
export const REFERRAL_MENTOR_EVENT = "referral_mentor_credits";
export const REFERRAL_MENTOR_LOT_PREFIX = "first_charge:";

/** Strict: only the literal "true" is on. */
export function referralMentorCreditsEnabled(env: Env = process.env): boolean {
  return (env[REFERRAL_MENTOR_CREDITS_ENV] ?? "").trim() === "true";
}

/** The credit amount for copy while the program is on, else null. */
export function referralMentorCreditsOffered(env: Env = process.env): number | null {
  return referralMentorCreditsEnabled(env) ? REFERRAL_MENTOR_CREDITS : null;
}

export function referralMentorLotSourceId(referralId: string): string {
  return `${REFERRAL_MENTOR_LOT_PREFIX}${referralId}`;
}

/** UTC instant of the first moment of the Europe/Vienna calendar month containing `now`. */
export function viennaMonthStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  // Vienna is UTC+1 or UTC+2; resolve local midnight of day 1 to UTC.
  const guess = Date.UTC(year, month - 1, 1);
  const offsetAt = (ms: number) => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(f.find((p) => p.type === t)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - ms;
  };
  let start = guess - offsetAt(guess);
  start = guess - offsetAt(start);
  return new Date(start);
}

// ─── Pure decision ──────────────────────────────────────────────────────

export interface PaymentEntry { payment_id?: string | null; amount_cents?: number | null }
export interface RefereeSub {
  id: string;
  created_at: string | null;
  status: string | null;
  amount_cents: number | null;
  provider_payment_id: string | null;
  granted_payment_ids: PaymentEntry[] | null;
}

export type ReferralMentorSkip =
  | "self_referral"
  | "referrer_missing"
  | "referrer_banned"
  | "payment_refunded"
  | "not_first_charge"
  | "old_account"
  | "prior_subscription"
  | "monthly_cap";

export interface DecisionFacts {
  paymentId: string;
  referral: { id: string; referrer_user_id: string; referee_user_id: string; created_at: string };
  refereeCreatedAt: string | null;
  refereeSubs: RefereeSub[];
  referrer: { is_banned: boolean | null } | null;
  /** first_charge lots the referrer already received this Vienna month. */
  monthCount: number;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function carriesPayment(s: RefereeSub, paymentId: string): boolean {
  return s.provider_payment_id === paymentId || (s.granted_payment_ids ?? []).some((e) => e?.payment_id === paymentId);
}

/** Another positive charge on any of the referee's rows. */
export function hasEarlierPaidCharge(subs: RefereeSub[], paymentId: string): boolean {
  for (const s of subs) {
    const history = Array.isArray(s.granted_payment_ids) ? s.granted_payment_ids : [];
    if (history.some((e) => e && e.payment_id !== paymentId && Number(e.amount_cents ?? 0) > 0)) return true;
    // A row without history, paid by another payment (legacy or manual rows).
    if (history.length === 0 && Number(s.amount_cents ?? 0) > 0 && s.provider_payment_id !== paymentId) return true;
  }
  return false;
}

export function decideReferralMentorCredit(f: DecisionFacts): { grant: true } | { grant: false; reason: ReferralMentorSkip } {
  const r = f.referral;
  if (r.referrer_user_id === r.referee_user_id) return { grant: false, reason: "self_referral" };
  if (!f.referrer) return { grant: false, reason: "referrer_missing" };
  if (f.referrer.is_banned) return { grant: false, reason: "referrer_banned" };
  if (f.refereeSubs.some((s) => carriesPayment(s, f.paymentId) && (s.status === "refunded"))) return { grant: false, reason: "payment_refunded" };
  if (hasEarlierPaidCharge(f.refereeSubs, f.paymentId)) return { grant: false, reason: "not_first_charge" };
  const claim = ms(r.created_at);
  const created = ms(f.refereeCreatedAt);
  if (claim === null || created === null || created > claim + CLAIM_SKEW_MS || claim - created > REFERRAL_NEW_ACCOUNT_WINDOW_MS) {
    return { grant: false, reason: "old_account" };
  }
  if (f.refereeSubs.some((s) => { const c = ms(s.created_at); return c === null || c < claim; })) return { grant: false, reason: "prior_subscription" };
  if (f.monthCount >= REFERRAL_MENTOR_MONTHLY_CAP) return { grant: false, reason: "monthly_cap" };
  return { grant: true };
}

// ─── Grant ──────────────────────────────────────────────────────────────

export type ReferralMentorOutcome =
  | { status: "off" }
  | { status: "not_paid" }
  | { status: "no_referral" }
  | { status: "decided_before" }
  | { status: "skipped"; reason: ReferralMentorSkip }
  | { status: "granted"; lotId: string | null; referrerAdmitted: boolean; duplicate: boolean }
  | { status: "error"; step: string };

export interface RewardArgs {
  refereeId: string;
  paymentId: string | null;
  amountCents: number | null;
  /** Where the call came from, for the audit row. */
  via: "webhook" | "checkout_verify" | "checkout_verify_fallback";
  now?: Date;
  env?: Env;
  /** Whether the referrer can open the mentor under MENTOR_ACCESS_SCOPE. Throwing counts as false. */
  referrerAdmitted?(referrerId: string): Promise<boolean>;
}

type DecisionRow = { user_id: string; event_data: Record<string, unknown> | null };

/**
 * The referrer's audit rows, read through the (user_id, event_type) index;
 * jsonb fields are matched in code. A referrer earns at most 3 a month, so
 * 500 rows cover years. null on a read error.
 */
async function decisionRows(sb: Db, referrerId: string): Promise<DecisionRow[] | null> {
  const { data, error } = await sb.from("user_events").select("user_id, event_data")
    .eq("user_id", referrerId).eq("event_type", REFERRAL_MENTOR_EVENT).order("created_at", { ascending: false }).limit(500);
  return error ? null : ((data ?? []) as DecisionRow[]);
}

async function writeDecision(sb: Db, referrerId: string, data: Record<string, unknown>): Promise<void> {
  const { error } = await sb.from("user_events").insert({ user_id: referrerId, event_type: REFERRAL_MENTOR_EVENT, event_data: data });
  if (error) Sentry.captureMessage(`referral mentor credits: audit row failed (${error.code ?? "unknown"})`, { level: "warning", extra: { referrerId, ...data } });
}

/**
 * Best-effort, never throws: the referee's Pro grant has already landed and
 * must not be failed or retried because of this reward.
 */
export async function rewardReferrerOnFirstCharge(sb: Db, a: RewardArgs): Promise<ReferralMentorOutcome> {
  if (!referralMentorCreditsEnabled(a.env)) return { status: "off" };
  if (!a.paymentId || a.amountCents == null || !(a.amountCents > 0)) return { status: "not_paid" };
  const now = a.now ?? new Date();
  try {
    const ref = await sb.from("referrals").select("id, referrer_user_id, referee_user_id, created_at")
      .eq("referee_user_id", a.refereeId).order("created_at", { ascending: true }).limit(1);
    if (ref.error) return report("referral_read", a);
    const referral = (ref.data as DecisionFacts["referral"][] | null)?.[0];
    if (!referral || !referral.referrer_user_id) return { status: "no_referral" };
    const sourceId = referralMentorLotSourceId(referral.id);

    // A decision is final per referral (only the first paid charge can qualify).
    const [prior, lot] = await Promise.all([
      decisionRows(sb, referral.referrer_user_id),
      sb.from("ai_credit_lot").select("id").eq("source", "referral_reward").eq("source_id", sourceId).limit(1),
    ]);
    if (prior === null || lot.error) return report("decision_read", a);
    if (prior.some((r) => r.event_data?.referral_id === referral.id) || (lot.data ?? []).length > 0) return { status: "decided_before" };

    const monthStart = viennaMonthStart(now).toISOString();
    const [referee, subs, referrer, month] = await Promise.all([
      sb.from("users").select("created_at").eq("id", a.refereeId).maybeSingle(),
      sb.from("subscriptions").select("id, created_at, status, amount_cents, provider_payment_id, granted_payment_ids").eq("user_id", a.refereeId),
      sb.from("users").select("is_banned").eq("id", referral.referrer_user_id).maybeSingle(),
      sb.from("ai_credit_lot").select("id").eq("user_id", referral.referrer_user_id).eq("source", "referral_reward")
        .like("source_id", `${REFERRAL_MENTOR_LOT_PREFIX}%`).gte("created_at", monthStart).limit(REFERRAL_MENTOR_MONTHLY_CAP + 1),
    ]);
    if (referee.error || subs.error || referrer.error || month.error) return report("facts_read", a);

    const base = { referral_id: referral.id, referee_user_id: a.refereeId, payment_id: a.paymentId, amount_cents: a.amountCents, via: a.via };
    const decision = decideReferralMentorCredit({
      paymentId: a.paymentId,
      referral,
      refereeCreatedAt: (referee.data as { created_at?: string | null } | null)?.created_at ?? null,
      refereeSubs: (subs.data as RefereeSub[] | null) ?? [],
      referrer: (referrer.data as { is_banned: boolean | null } | null) ?? null,
      monthCount: (month.data ?? []).length,
    });
    if (!decision.grant) {
      if (decision.reason !== "referrer_missing") await writeDecision(sb, referral.referrer_user_id, { ...base, outcome: "skipped", reason: decision.reason });
      return { status: "skipped", reason: decision.reason };
    }

    let admitted = false;
    try { admitted = a.referrerAdmitted ? await a.referrerAdmitted(referral.referrer_user_id) : false; } catch { admitted = false; }
    const expiresAt = new Date(now.getTime() + REFERRAL_MENTOR_EXPIRY_DAYS * 86_400_000);
    const g = await rpcGrantCredits(sb, {
      userId: referral.referrer_user_id,
      packageId: "referral_reward",
      source: "referral_reward",
      sourceId,
      micro: REFERRAL_MENTOR_CREDIT_MICRO,
      startsAt: now,
      expiresAt,
    });
    if (!g.ok) return report(`grant_${g.reason ?? "failed"}`, a);
    if (!g.duplicate) {
      await writeDecision(sb, referral.referrer_user_id, {
        ...base, outcome: "granted", lot_id: g.lotId, lot_source_id: sourceId, credits: REFERRAL_MENTOR_CREDITS,
        expires_at: expiresAt.toISOString(), ...(admitted ? {} : { reason: "referrer_not_admitted" }),
      });
    }
    return { status: "granted", lotId: g.lotId, referrerAdmitted: admitted, duplicate: g.duplicate };
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "referral-mentor-credits", step: "unexpected" } });
    return { status: "error", step: "unexpected" };
  }
}

function report(step: string, a: RewardArgs): ReferralMentorOutcome {
  Sentry.captureMessage(`referral mentor credits not decided (${step}); grant by hand if the referee's first charge qualifies`, {
    level: "warning", extra: { refereeId: a.refereeId, paymentId: a.paymentId, via: a.via },
  });
  return { status: "error", step };
}

// ─── Clawback ───────────────────────────────────────────────────────────

/**
 * Refund or dispute of a referee's charge: claw back the referral lot that
 * charge earned. Runs whatever the flag says, so switching the program off
 * never strands a reward on a refunded payment. Every read is keyed: the
 * payment's grant_succeeded row names the referee (payment_events.payment_id
 * index), the referral comes by referee_user_id, the granted audit row by the
 * referrer's (user_id, event_type) and must name this exact payment, so the
 * refund of a later renewal never removes the reward. Never throws.
 */
export async function clawbackReferralMentorCredit(sb: Db, paymentIds: string[], event: string): Promise<{ clawed: number }> {
  const ids = [...new Set(paymentIds.filter((p) => typeof p === "string" && p.length > 0 && p.length <= 200))];
  if (ids.length === 0) return { clawed: 0 };
  let clawed = 0;
  try {
    const grants = await sb.from("payment_events").select("user_id").in("payment_id", ids).eq("event", "grant_succeeded").not("user_id", "is", null).limit(20);
    if (grants.error) return lookupFailed(ids, "payment_events");
    const referees = [...new Set(((grants.data ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id).filter((u): u is string => !!u))];
    if (referees.length === 0) return { clawed: 0 };
    const refs = await sb.from("referrals").select("id, referrer_user_id").in("referee_user_id", referees).limit(20);
    if (refs.error) return lookupFailed(ids, "referrals");
    for (const ref of (refs.data ?? []) as Array<{ id: string; referrer_user_id: string | null }>) {
      if (!ref.referrer_user_id) continue;
      const rows = await decisionRows(sb, ref.referrer_user_id);
      if (rows === null) { lookupFailed(ids, "user_events"); continue; }
      const granted = rows.find((r) => r.event_data?.referral_id === ref.id && r.event_data?.outcome === "granted" && ids.includes(String(r.event_data?.payment_id)));
      if (!granted) continue;
      const sourceId = referralMentorLotSourceId(ref.id);
      const r = await rpcClawback(sb, "referral_reward", sourceId, `referee ${event}`);
      if (!r.ok) {
        Sentry.captureMessage(`referral mentor clawback failed (${r.reason}) for ${sourceId}`, "warning");
        continue;
      }
      if (r.duplicate) continue;
      clawed++;
      await writeDecision(sb, ref.referrer_user_id, {
        referral_id: ref.id, payment_id: granted.event_data?.payment_id ?? null, lot_source_id: sourceId,
        outcome: "clawed_back", reason: event, clawed_micro: r.clawedMicro,
      });
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "referral-mentor-credits", step: "clawback" } });
  }
  return { clawed };
}

function lookupFailed(ids: string[], step: string): { clawed: number } {
  Sentry.captureMessage(`referral mentor clawback lookup failed (${step}) for ${ids.join(",")}; check by hand`, "warning");
  return { clawed: 0 };
}
