/**
 * Free mentor credit hooks (a-free-credit-hooks, 14 Oct 2026; product.json
 * levers G0, L1, L3, L4, L5 and marketing M9 of reports/ai-credits-2026-10-14).
 * The ONE owner of every house-funded amount, its flag and its monthly cap.
 * Server and client safe (no I/O, no Node APIs).
 *
 * Rule: an amount applies only while its own flag is on. With every flag off
 * each grant is byte for byte what it was before this package (the package
 * row amounts, the allowlist-only gate, 50 referral credits capped at 3).
 *
 *   MENTOR_HOUSE_GRANTS_SCOPE          unset = allowlist only (today);
 *                                      "signed_in" = every admitted account
 *                                      gets the house-funded grants it is
 *                                      entitled to (included, trial, tastes).
 *   MENTOR_INCLUDED_RAISE_ENABLED      Pro 200 / Cohort 400 / card trial 100
 *                                      per lot instead of the package rows.
 *   MENTOR_WELCOME_ENABLED             25 credits once, 30 days, monthly
 *                                      breaker 200 grants (Vienna month).
 *   REFERRAL_MENTOR_RAISE_ENABLED      first-charge reward 200, cap 5 a month.
 *   REFERRAL_TRIAL_START_CREDITS_ENABLED  25 credits when the referee starts
 *                                      the card trial, cap 5 a month.
 *   MENTOR_EXPERIENCE_REWARD_ENABLED   100 credits once for a first-party
 *                                      testimonial, granted by an admin.
 *   MENTOR_CAMPAIGN_CODES_ENABLED      admin-made codes (amount, expiry and
 *                                      caps live on the code row).
 *   REWARDS_WINBACK_ENABLED            100 credits (30 days) when paid access
 *                                      ends, at most once per 90 days per
 *                                      learner (a-winback-credits, J11).
 *
 * Every amount and cap below can be tuned in env; out-of-range values fall
 * back to the default. Credits are whole numbers; 1 credit = 5,000 micro-USD.
 */

type Env = Record<string, string | undefined>;

/** Same as CREDIT_MICRO_USD (src/lib/mentor/config.ts); repeated here so this module stays import-free. */
export const FREE_CREDIT_MICRO_PER_CREDIT = 5_000;

export const FREE_CREDIT_DEFAULTS = Object.freeze({
  proIncludedCredits: 200,
  cohortIncludedCredits: 400,
  trialTasteCredits: 100,
  welcomeCredits: 25,
  welcomeExpiryDays: 30,
  welcomeMonthlyCap: 200,
  /** Distinct answered questions that make an unverified account eligible for the welcome lot. */
  welcomeMinQuestions: 10,
  referralFirstChargeCredits: 200,
  referralFirstChargeMonthlyCap: 5,
  referralTrialStartCredits: 25,
  referralTrialStartMonthlyCap: 5,
  experienceCredits: 100,
  experienceExpiryDays: 30,
  campaignCredits: 100,
  campaignExpiryDays: 60,
  /** J11: win-back credits when paid access ends. */
  winbackCredits: 100,
  winbackExpiryDays: 30,
  /** Days after signup in which an existing account may still redeem a campaign code. */
  campaignAccountMaxAgeDays: 7,
  /** G0 (d): monthly house cost per scope-admitted account before the daily rate is cut. */
  houseCostCapMicro: 250_000,
  /** G0 (d): the same for accounts funded only by free lots (tastes, welcome, codes, rewards). */
  houseCostCapTasteMicro: 100_000,
});

/** Today's values, used while the raise flags are off. */
export const LEGACY_REFERRAL_CREDITS = 50;
export const LEGACY_REFERRAL_MONTHLY_CAP = 3;

export const FREE_CREDIT_ENV = Object.freeze({
  houseGrantsScope: "MENTOR_HOUSE_GRANTS_SCOPE",
  includedRaise: "MENTOR_INCLUDED_RAISE_ENABLED",
  proIncludedCredits: "MENTOR_INCLUDED_PRO_CREDITS",
  cohortIncludedCredits: "MENTOR_INCLUDED_COHORT_CREDITS",
  trialTasteCredits: "MENTOR_TRIAL_TASTE_CREDITS",
  welcome: "MENTOR_WELCOME_ENABLED",
  welcomeCredits: "MENTOR_WELCOME_CREDITS",
  welcomeExpiryDays: "MENTOR_WELCOME_EXPIRY_DAYS",
  welcomeMonthlyCap: "MENTOR_WELCOME_MONTHLY_CAP",
  referralRaise: "REFERRAL_MENTOR_RAISE_ENABLED",
  referralFirstChargeCredits: "REFERRAL_MENTOR_CREDITS_AMOUNT",
  referralFirstChargeMonthlyCap: "REFERRAL_MENTOR_MONTHLY_CAP",
  referralTrialStart: "REFERRAL_TRIAL_START_CREDITS_ENABLED",
  referralTrialStartCredits: "REFERRAL_TRIAL_START_CREDITS",
  referralTrialStartMonthlyCap: "REFERRAL_TRIAL_START_MONTHLY_CAP",
  experience: "MENTOR_EXPERIENCE_REWARD_ENABLED",
  experienceCredits: "MENTOR_EXPERIENCE_CREDITS",
  experienceExpiryDays: "MENTOR_EXPERIENCE_EXPIRY_DAYS",
  campaign: "MENTOR_CAMPAIGN_CODES_ENABLED",
  winback: "REWARDS_WINBACK_ENABLED",
  winbackCredits: "REWARDS_WINBACK_CREDITS",
  winbackExpiryDays: "REWARDS_WINBACK_EXPIRY_DAYS",
  houseCostCapMicro: "MENTOR_HOUSE_COST_CAP_MICRO",
  houseCostCapTasteMicro: "MENTOR_HOUSE_COST_CAP_TASTE_MICRO",
} as const);

export type HouseGrantsScope = "allowlist" | "signed_in";

export interface FreeCreditConfig {
  houseGrantsScope: HouseGrantsScope;
  includedRaise: boolean;
  proIncludedCredits: number;
  cohortIncludedCredits: number;
  trialTasteCredits: number;
  welcomeEnabled: boolean;
  welcomeCredits: number;
  welcomeExpiryDays: number;
  welcomeMonthlyCap: number;
  welcomeMinQuestions: number;
  referralRaise: boolean;
  /** The first-charge reward in force (50 while the raise is off). */
  referralFirstChargeCredits: number;
  referralFirstChargeMonthlyCap: number;
  referralTrialStartEnabled: boolean;
  referralTrialStartCredits: number;
  referralTrialStartMonthlyCap: number;
  experienceEnabled: boolean;
  experienceCredits: number;
  experienceExpiryDays: number;
  campaignEnabled: boolean;
  campaignAccountMaxAgeDays: number;
  winbackEnabled: boolean;
  winbackCredits: number;
  winbackExpiryDays: number;
  houseCostCapMicro: number;
  houseCostCapTasteMicro: number;
  /**
   * a-rewards-program: an exam report or fix reward flag is on, so reward
   * lots (admin_gift, key prefix reward:) may exist and count as free-hook
   * lots for the house cap. Read from REWARD_FLAG_ENVS.
   */
  rewardLotsEnabled: boolean;
  /**
   * a-seed-seats: SEED_SEATS_ENABLED is on (only the literal "true"; the same
   * read as src/lib/seed-seats seedSeatsFlag, repeated so this module stays
   * import-free). Seat holders spend house-funded campaign_code lots, so the
   * house cap and the 95 % stop consider them.
   */
  seatsEnabled: boolean;
}

/**
 * The reward program flags (owner: REWARD_ENV in src/lib/rewards-program.ts;
 * repeated here so this module stays import-free; a unit test keeps them equal).
 */
export const REWARD_FLAG_ENVS = Object.freeze(["REWARDS_EXAM_REPORT_ENABLED", "REWARDS_FIX_ENABLED"] as const);

/** Strict: only the literal "true" is on. */
function on(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "true";
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Only the exact literal widens; anything else keeps today's allowlist-only rule. */
export function parseHouseGrantsScope(raw: string | undefined): HouseGrantsScope {
  return (raw ?? "").trim() === "signed_in" ? "signed_in" : "allowlist";
}

export function readFreeCreditConfig(env: Env = process.env): FreeCreditConfig {
  const d = FREE_CREDIT_DEFAULTS;
  const referralRaise = on(env[FREE_CREDIT_ENV.referralRaise]);
  return {
    houseGrantsScope: parseHouseGrantsScope(env[FREE_CREDIT_ENV.houseGrantsScope]),
    includedRaise: on(env[FREE_CREDIT_ENV.includedRaise]),
    proIncludedCredits: int(env[FREE_CREDIT_ENV.proIncludedCredits], d.proIncludedCredits, 1, 2000),
    cohortIncludedCredits: int(env[FREE_CREDIT_ENV.cohortIncludedCredits], d.cohortIncludedCredits, 1, 4000),
    trialTasteCredits: int(env[FREE_CREDIT_ENV.trialTasteCredits], d.trialTasteCredits, 1, 1000),
    welcomeEnabled: on(env[FREE_CREDIT_ENV.welcome]),
    welcomeCredits: int(env[FREE_CREDIT_ENV.welcomeCredits], d.welcomeCredits, 1, 500),
    welcomeExpiryDays: int(env[FREE_CREDIT_ENV.welcomeExpiryDays], d.welcomeExpiryDays, 1, 180),
    welcomeMonthlyCap: int(env[FREE_CREDIT_ENV.welcomeMonthlyCap], d.welcomeMonthlyCap, 0, 10_000),
    welcomeMinQuestions: d.welcomeMinQuestions,
    referralRaise,
    referralFirstChargeCredits: referralRaise
      ? int(env[FREE_CREDIT_ENV.referralFirstChargeCredits], d.referralFirstChargeCredits, 1, 2000)
      : LEGACY_REFERRAL_CREDITS,
    referralFirstChargeMonthlyCap: referralRaise
      ? int(env[FREE_CREDIT_ENV.referralFirstChargeMonthlyCap], d.referralFirstChargeMonthlyCap, 1, 50)
      : LEGACY_REFERRAL_MONTHLY_CAP,
    referralTrialStartEnabled: on(env[FREE_CREDIT_ENV.referralTrialStart]),
    referralTrialStartCredits: int(env[FREE_CREDIT_ENV.referralTrialStartCredits], d.referralTrialStartCredits, 1, 500),
    referralTrialStartMonthlyCap: int(env[FREE_CREDIT_ENV.referralTrialStartMonthlyCap], d.referralTrialStartMonthlyCap, 1, 50),
    experienceEnabled: on(env[FREE_CREDIT_ENV.experience]),
    experienceCredits: int(env[FREE_CREDIT_ENV.experienceCredits], d.experienceCredits, 1, 1000),
    experienceExpiryDays: int(env[FREE_CREDIT_ENV.experienceExpiryDays], d.experienceExpiryDays, 1, 180),
    campaignEnabled: on(env[FREE_CREDIT_ENV.campaign]),
    campaignAccountMaxAgeDays: d.campaignAccountMaxAgeDays,
    winbackEnabled: on(env[FREE_CREDIT_ENV.winback]),
    winbackCredits: int(env[FREE_CREDIT_ENV.winbackCredits], d.winbackCredits, 1, 1000),
    winbackExpiryDays: int(env[FREE_CREDIT_ENV.winbackExpiryDays], d.winbackExpiryDays, 1, 180),
    houseCostCapMicro: int(env[FREE_CREDIT_ENV.houseCostCapMicro], d.houseCostCapMicro, 1, 100_000_000),
    houseCostCapTasteMicro: int(env[FREE_CREDIT_ENV.houseCostCapTasteMicro], d.houseCostCapTasteMicro, 1, 100_000_000),
    rewardLotsEnabled: REWARD_FLAG_ENVS.some((k) => on(env[k])),
    seatsEnabled: on(env.SEED_SEATS_ENABLED),
  };
}

export function creditsToMicro(credits: number): number {
  return Math.round(credits * FREE_CREDIT_MICRO_PER_CREDIT);
}

/**
 * Included lot amounts in micro-USD while MENTOR_INCLUDED_RAISE_ENABLED is on,
 * keyed by package id. Empty while off: the package rows decide, as before.
 */
export function includedAmountOverrides(c: FreeCreditConfig): Partial<Record<string, number>> {
  if (!c.includedRaise) return {};
  return {
    included_pro_monthly: creditsToMicro(c.proIncludedCredits),
    included_pro_quarterly: creditsToMicro(c.proIncludedCredits),
    included_cohort: creditsToMicro(c.cohortIncludedCredits),
    trial_taste: creditsToMicro(c.trialTasteCredits),
  };
}

/** New lot sources of this package (migration 20270102090000). */
export const FREE_LOT_SOURCES = Object.freeze({
  welcome: "welcome_taste",
  campaign: "campaign_code",
  experience: "experience_reward",
} as const);

/**
 * Lot sources that cost the learner nothing: an account whose live lots are
 * all from this list is "funded only by gifts or tastes" (G0 d).
 */
export const HOUSE_FUNDED_TASTE_SOURCES: ReadonlySet<string> = new Set([
  "free_taste",
  "trial_taste",
  "welcome_taste",
  "campaign_code",
  "experience_reward",
  "beta_grant",
  "admin_gift",
]);

/** Sources whose presence switches the per-account house cap on even while the house scope is allowlist. */
export const FREE_CREDIT_HOOK_SOURCES: ReadonlySet<string> = new Set(["welcome_taste", "campaign_code", "experience_reward"]);

/** The experience reward key: one per person, ever. */
export function experienceRewardSourceId(userId: string): string {
  return `testimonial:${userId}`;
}

/**
 * Win-back lots (J11) reuse the catalogue row gift_admin and the lot source
 * admin_gift with a prefixed key, so no lot-source migration is needed:
 * one lot per ended subscription row (UNIQUE(source, source_id)); the
 * 90-day breaker per learner is a separate read (winback.ts).
 */
export const WINBACK_LOT = Object.freeze({ packageId: "gift_admin", source: "admin_gift", prefix: "reward:winback:" } as const);

export function winbackSourceId(subscriptionId: string): string {
  return `${WINBACK_LOT.prefix}${subscriptionId}`;
}

export function isWinbackLot(source: string, sourceId: string | null | undefined): boolean {
  return source === WINBACK_LOT.source && typeof sourceId === "string" && sourceId.startsWith(WINBACK_LOT.prefix);
}

/** The campaign code key: one code redemption per account, ever (any code). */
export function campaignSourceId(userId: string): string {
  return `campaign:${userId}`;
}

/** Code shape: 3 to 24 characters, upper-case letters, digits and single hyphens. */
export const CAMPAIGN_CODE_RE = /^[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9])){2,23}$/;

/** Normalises a typed or linked code; null when it cannot be a code. */
export function normalizeCampaignCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return CAMPAIGN_CODE_RE.test(v) ? v : null;
}
