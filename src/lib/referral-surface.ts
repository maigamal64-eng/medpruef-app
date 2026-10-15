/**
 * Referral surfaces (a-referral-surface, 14 Oct 2026). Pure, client-safe.
 *
 * The 50 mentor credits a referrer receives when a colleague pays for Pro for
 * the first time (referral-mentor-credits.ts) were invisible. Three places now
 * offer the personal invite, all behind REFERRAL_SURFACE_ENABLED (server env,
 * default OFF; read only by GET /api/referrals/invite, which answers
 * `enabled:false` while it is off):
 *   1. the mentor 0-credit refer note gets one-tap copy and share intents;
 *   2. a small Home card (gate surface "referral_card") for learners in the
 *      referral program who answered on 3+ Vienna days in the last 14 days,
 *      at most once a week, dismissible for a week;
 *   3. one line after a recorded passed exam (/stats) and after a mock exam
 *      above its own threshold.
 * The invite text and disclosure are referral-copy.ts (TR-27); the surface
 * strings are referral-surface-copy.ts (Lektor, 14 Oct).
 */

export const REFERRAL_SURFACE_ENV = "REFERRAL_SURFACE_ENABLED";
export const REFERRAL_CARD_MIN_DAYS = 3;
export const REFERRAL_CARD_WINDOW_DAYS = 14;
export const REFERRAL_CARD_INTERVAL_MS = 7 * 86_400_000;
/** Per-account stamp of the last time the Home card was shown (device-local). */
export const REFERRAL_CARD_STAMP_KEY = "medpruef_referral_card_v1";

type Env = Record<string, string | undefined>;

/** Strict: only the literal "true" is on. */
export function referralSurfaceFlag(env: Env): boolean {
  return (env[REFERRAL_SURFACE_ENV] ?? "").trim() === "true";
}

/**
 * The surfaces show only when the flag is on, the account is enrolled in the
 * referral program and the exam reward is live: the invite message and its
 * disclosure state the exam reward in the first person (Lektor condition, 14 Oct),
 * so with that program off they would promise something the product does not do.
 */
export function referralSurfaceEnabled(input: { flag: boolean; referralsEnabled: boolean; examRewardEnabled: boolean }): boolean {
  return input.flag && input.referralsEnabled && input.examRewardEnabled;
}

/** Home card eligibility from the server read: 3+ active days in the 14-day window. */
export function referralCardEligible(activeDays14: number): boolean {
  return Number.isFinite(activeDays14) && activeDays14 >= REFERRAL_CARD_MIN_DAYS;
}

/**
 * Weekly cadence. `lastShownAt` is the device-local stamp of the session that
 * last showed the card; `shownThisSession` keeps it visible for the rest of
 * that browser session instead of vanishing on the next navigation.
 */
export function referralCardDue(lastShownAt: number | null, now: number, shownThisSession = false): boolean {
  if (shownThisSession) return true;
  if (lastShownAt === null || !Number.isFinite(lastShownAt)) return true;
  if (lastShownAt > now) return false;
  return now - lastShownAt >= REFERRAL_CARD_INTERVAL_MS;
}

/** Read a stamp written by `referralCardStampValue`; anything else is "never shown". */
export function parseReferralCardStamp(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Share surfaces, also the `source` field of referral_share_clicked. */
export type ReferralSurface = "mentor_zero" | "home_card" | "exam_pass" | "mock_exam";
