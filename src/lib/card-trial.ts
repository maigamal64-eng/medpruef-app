/**
 * The Whop card trial (decision whop-card-trial-1024, [name] 24 Oct 2026).
 *
 * Two tiers are a card trial: the dormant 7-day `notes_pro_trial` (v1, 19 EUR
 * renewals, plan WHOP_PLAN_NOTES_TRIAL; its live payers still renew through
 * it) and the v2 `flex_month_trial`: 3 days of full Pro, card on file, 0 EUR
 * today, then 24 EUR every 30 days on the hidden Whop plan WHOP_PLAN_FLEX_TRIAL
 * until the learner cancels. Every route that used to hard-code
 * "notes_pro_trial" asks this module instead, so both tiers share one rule.
 *
 * Switch: CARD_TRIAL_ENABLED (server, only the literal "true"), mirrored at
 * build into NEXT_PUBLIC_CARD_TRIAL (next.config.ts), like the reverse trial:
 * the trial runs only when the build copy AND the runtime env are on, so
 * switching it on needs a redeploy (copy and grants agree) and switching the
 * runtime env off stops new trial checkouts at once. It never runs next to the
 * reverse trial (build gate in src/lib/card-trial-gate.ts).
 *
 * Client-safe: no server imports. Tests pass their own env object.
 */
import { reverseTrialCopyEnabled, reverseTrialEnabled } from "@/lib/pricing-v2/flag";

type Env = Record<string, string | undefined>;

export const CARD_TRIAL_TIERS = ["notes_pro_trial", "flex_month_trial"] as const;
export type CardTrialTier = (typeof CARD_TRIAL_TIERS)[number];

/** Free days of each card trial (the Whop plan's trial_period_days). */
export const CARD_TRIAL_DAYS: Readonly<Record<CardTrialTier, number>> = {
  notes_pro_trial: 7,
  flex_month_trial: 3,
};

/** The env name of each card trial's Whop plan id. */
export const CARD_TRIAL_PLAN_ENV: Readonly<Record<CardTrialTier, string>> = {
  notes_pro_trial: "WHOP_PLAN_NOTES_TRIAL",
  flex_month_trial: "WHOP_PLAN_FLEX_TRIAL",
};

const DAY_MS = 86_400_000;

export function isCardTrialTier(tier: unknown): tier is CardTrialTier {
  return typeof tier === "string" && (CARD_TRIAL_TIERS as readonly string[]).includes(tier);
}

/** Free days of a card trial tier; 0 for any other tier. */
export function cardTrialDays(tier: unknown): number {
  return isCardTrialTier(tier) ? CARD_TRIAL_DAYS[tier] : 0;
}

/**
 * Access window of a trial start when Whop's period end is unknown: the trial
 * days plus one safety day for a late first-charge webhook (the same design
 * as the 7-day trial's 8 days). 0 for any other tier.
 */
export function cardTrialWindowMs(tier: unknown): number {
  return isCardTrialTier(tier) ? (CARD_TRIAL_DAYS[tier] + 1) * DAY_MS : 0;
}

/** Build copy of the switch: what the terms, FAQ, landing and pricing copy promise. */
export function cardTrialCopyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CARD_TRIAL === "true" && !reverseTrialCopyEnabled();
}

function planSet(env: Env, tier: CardTrialTier): boolean {
  return Boolean(env[CARD_TRIAL_PLAN_ENV[tier]]?.trim());
}

/**
 * Can a new learner start the 3-day card trial right now? Build copy and
 * runtime env on, the reverse trial off and the Whop plan configured.
 */
export function cardTrialEnabled(env?: Env): boolean {
  if (env) return env.CARD_TRIAL_ENABLED === "true" && !reverseTrialEnabled(env) && planSet(env, "flex_month_trial");
  return cardTrialCopyEnabled() && process.env.CARD_TRIAL_ENABLED === "true" && !reverseTrialEnabled() &&
    planSet(process.env, "flex_month_trial");
}

/** The dormant 7-day v1 trial (NOTES_TRIAL_ENABLED); yields to the reverse trial. */
export function notesTrialEnabled(env?: Env): boolean {
  const e = env ?? process.env;
  return (e.NOTES_TRIAL_ENABLED ?? "false").toLowerCase() === "true" && !(env ? reverseTrialEnabled(env) : reverseTrialEnabled());
}

/**
 * The tier a new trial checkout uses: the 3-day card trial when it is on,
 * else the v1 7-day trial when NOTES_TRIAL_ENABLED is on, else none.
 */
export function activeCardTrialTier(env?: Env): CardTrialTier | null {
  if (cardTrialEnabled(env)) return "flex_month_trial";
  if (notesTrialEnabled(env)) return "notes_pro_trial";
  return null;
}

/**
 * The card trial tiers a returning learner may still finish (verify): the
 * active one first, then any other tier whose own switch is on or that is the
 * 3-day trial with its plan configured. A learner who started the 3-day trial
 * just before a rollback (CARD_TRIAL_ENABLED off) still gets the access their
 * real Whop membership pays for; verify grants only on a membership whose
 * metadata names the learner.
 */
export function verifiableCardTrialTiers(env?: Env): CardTrialTier[] {
  const e = env ?? process.env;
  const out: CardTrialTier[] = [];
  const active = activeCardTrialTier(env);
  if (active) out.push(active);
  if (!out.includes("flex_month_trial") && planSet(e, "flex_month_trial")) out.push("flex_month_trial");
  if (!out.includes("notes_pro_trial") && notesTrialEnabled(env)) out.push("notes_pro_trial");
  return out;
}

export type CardTrialRefusal = "pro" | "card_trial_used" | "reverse_trial_used" | "paid_before" | "email_used";

interface SubRowLike {
  tier: string | null;
  status: string | null;
  payment_provider: string | null;
  amount_cents: number | null;
  granted_payment_ids: unknown;
}

const REVERSED = new Set(["refunded", "chargeback", "disputed"]);

function paidWhopRow(r: SubRowLike): boolean {
  if (r.payment_provider !== "whop" || REVERSED.has(String(r.status ?? ""))) return false;
  if ((r.amount_cents ?? 0) > 0) return true;
  const entries = Array.isArray(r.granted_payment_ids) ? r.granted_payment_ids : [];
  return entries.some((e) => Number((e as { amount_cents?: unknown } | null)?.amount_cents ?? 0) > 0);
}

/**
 * The abuse limits (PLAN 3e, no migration): one card trial per account, none
 * after the reverse trial, none for a learner who has paid before (they get
 * the paid checkout), and none when the account's email already started a
 * reverse trial on another account. A card is the seriousness gate on top;
 * Whop refuses a second free trial to the same payer on the same plan.
 * Pure: the caller reads the rows. Returns the first refusal or null.
 */
export function cardTrialRefusal(input: {
  isPro: boolean;
  subscriptions: readonly SubRowLike[];
  /** A trials row exists for this account (reverse or legacy trial used). */
  trialRowForUser: boolean;
  /** A trials row carries this account's email key. */
  trialRowForEmail: boolean;
}): CardTrialRefusal | null {
  if (input.isPro) return "pro";
  if (input.subscriptions.some((r) => isCardTrialTier(r.tier))) return "card_trial_used";
  if (input.trialRowForUser || input.subscriptions.some((r) => r.tier === "reverse_trial")) return "reverse_trial_used";
  if (input.subscriptions.some(paidWhopRow)) return "paid_before";
  if (input.trialRowForEmail) return "email_used";
  return null;
}
