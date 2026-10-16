/**
 * "Your plan to your sitting" (a-trial-end-decision), pure rules.
 *
 * Every new account gets the 3-day reverse trial (a-pricing-v2) and older
 * never-paid accounts may claim it once (a-reverse-trial-claim). Both write a
 * trials row of kind 'reverse' with its dated end, so one rule covers both:
 *
 *   last_day  the trial still runs and ends within 24 hours (banner state)
 *   ended     the trial ended at most ENDED_WINDOW_DAYS ago and the account
 *             has no access of its own since (Home card once, paywall)
 *   none      no reverse trial, it runs longer than 24 hours, it ended long
 *             ago, the account ever paid, or it holds other access
 *
 * The card states only the real trial end as a time; no other countdown, no
 * price-change urgency, no break-even (totals come from fit.ts, price last).
 */
import { sittingFit, type PlanFit } from "@/lib/pricing-v2/fit";
import type { V2Tier } from "@/lib/pricing-v2/offer";
import type { V2Readiness } from "@/lib/pricing-v2/readiness";
import type { PuypExamType } from "@/lib/exam-dates";
import { ACTION_FOR } from "@/app/pricing/_parts/plans";
import { classifyTopics } from "@/lib/weak-topics";

const DAY_MS = 86_400_000;
export const LAST_DAY_MS = DAY_MS;
export const ENDED_WINDOW_DAYS = 30;
/** Access that ends this much after the trial end is the learner's own (a purchase or grant). */
const OWN_ACCESS_MARGIN_MS = 60_000;

export type TrialEndState = "last_day" | "ended" | "none";
export type TrialEndSurface = "banner" | "home" | "paywall";
export type TrialEndTarget = "checkout" | "pricing" | "later";
export type TrialKind = "auto" | "claim";

export const TRIAL_END_SURFACES: readonly TrialEndSurface[] = ["banner", "home", "paywall"];
export const TRIAL_END_TARGETS: readonly TrialEndTarget[] = ["checkout", "pricing", "later"];
export const TRIAL_END_SHOWN = "trial_end_card_shown";
export const TRIAL_END_CLICK = "trial_end_card_click";

export function isSurface(v: unknown): v is TrialEndSurface {
  return typeof v === "string" && (TRIAL_END_SURFACES as readonly string[]).includes(v);
}
export function isTarget(v: unknown): v is TrialEndTarget {
  return typeof v === "string" && (TRIAL_END_TARGETS as readonly string[]).includes(v);
}

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

export interface TrialEndInput {
  /** trials.expires_at of this account's own reverse trial, else null. */
  trialEndsAt: string | null;
  /** A subscription row of this account ever moved money (refunds included). */
  everPaid: boolean;
  user: { role: string | null; tier: string | null; tierExpiresAt: string | null };
  now: Date;
}

export function trialEndState(i: TrialEndInput): TrialEndState {
  const end = ms(i.trialEndsAt);
  if (!Number.isFinite(end) || i.everPaid) return "none";
  if (i.user.role === "admin" || i.user.tier === "admin") return "none";
  const now = i.now.getTime();
  if (i.user.tier === "pro") {
    const access = ms(i.user.tierExpiresAt);
    // Permanent Pro, or access past the trial end: the learner's own access.
    if (!i.user.tierExpiresAt || (Number.isFinite(access) && access > end + OWN_ACCESS_MARGIN_MS)) return "none";
  }
  if (end > now) return end - now <= LAST_DAY_MS ? "last_day" : "none";
  return now - end <= ENDED_WINDOW_DAYS * DAY_MS ? "ended" : "none";
}

/** Automatic trial (account created after REVERSE_TRIAL_SINCE) or the one-time claim of an older account. */
export function trialKindOf(createdAt: string | null, since: Date | null): TrialKind {
  const created = ms(createdAt);
  if (!since || !Number.isFinite(created)) return "auto";
  return created >= since.getTime() ? "auto" : "claim";
}

// ── The plan that fits ──

export type CardTiming =
  | { kind: "sitting"; bank: PuypExamType; date: string; lastDay: string }
  | { kind: "long_route" }
  | { kind: "unsure" };

export interface CardPlan {
  tier: V2Tier;
  /** The fit to the chosen sitting, null without one. */
  fit: PlanFit | null;
}

/**
 * The cheapest plan that covers the sitting among the plans on sale
 * (fit.ts, decision sitting-fit). Several exams ahead: the Guarantee Ticket
 * when it is on sale. Not sure yet: Monthly (recommendTier's rule).
 */
export function cardPlan(timing: CardTiming, now: Date, opts: { guard: boolean; ready: V2Readiness }): CardPlan {
  if (timing.kind === "sitting") {
    const fit = sittingFit({ date: timing.date, lastDay: timing.lastDay }, now, { guard: opts.guard, ready: opts.ready });
    const tier = opts.ready[fit.recommended] ? fit.recommended : "flex_month";
    return { tier, fit: fit.plans[tier] };
  }
  if (timing.kind === "long_route" && opts.ready.guarantee_ticket) return { tier: "guarantee_ticket", fit: null };
  return { tier: "flex_month", fit: null };
}

/**
 * One tap to checkout: /pricing runs its resume path (account checks, the
 * confirm sheet when that flag is on, then Whop) with the plan and sitting.
 */
export function checkoutHref(tier: V2Tier, timing: CardTiming | null): string {
  const base = `/pricing?action=${ACTION_FOR[tier]}`;
  if (timing?.kind !== "sitting") return base;
  return `${base}&bank=${timing.bank}&sitting=${timing.date}&sitting_end=${timing.lastDay}`;
}

/**
 * A picked sitting becomes the learner's saved exam date only in the bank
 * they study (users.active_exam): another bank's date would move Home, the
 * deadline line and the study plan to that exam (reviewer P2-2).
 */
export function shouldSaveSitting(timing: CardTiming, activeBank: PuypExamType): boolean {
  return timing.kind === "sitting" && timing.bank === activeBank;
}

// ── Saved progress ──

export interface TopicProgressRow {
  topic: string;
  lastCorrectSample?: number | null;
  lastCorrectPct?: number | null;
}

/**
 * The weakest fields by the one weak-topic rule (MUX-68), with the Home
 * mentor card's mapping (TodayCard todayData): the newest-attempt sample and
 * share. Before that read exists, or with too few judged fields: none.
 */
export function weakestFields(rows: readonly TopicProgressRow[] | null, max = 2): string[] {
  if (!rows || !rows.some((t) => typeof t.lastCorrectSample === "number")) return [];
  const samples = rows.map((t) => ({
    topic: typeof t.topic === "string" ? t.topic : "",
    answered: typeof t.lastCorrectSample === "number" ? t.lastCorrectSample : 0,
    pct: typeof t.lastCorrectPct === "number" ? t.lastCorrectPct : null,
  })).filter((t) => t.topic);
  const { weak, thin } = classifyTopics(samples, { weak: max });
  return thin ? [] : weak.map((t) => t.topic);
}
