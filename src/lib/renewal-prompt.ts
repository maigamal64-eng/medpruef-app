/**
 * Renewal prompt — the decision logic behind the in-product banner that
 * tells a Pro user their access is about to end (or just ended) and
 * offers one click to the standard 3-month plan.
 *
 * Why a separate pure module: the vitest bar for this repo is
 * `tests/unit/**` in a node environment with no DOM and no JSX, so the
 * decision that actually matters ("does the user whose access ends on
 * 2026-09-08 see this on 2026-09-07?") is testable only if it lives
 * outside the component. `RenewalPrompt.tsx` is a thin shell over this.
 *
 * The two windows (SoT §2 pricing rail is untouched by any of this):
 *
 *   UPCOMING  expiry in [now, now + 7 days]   → "access ends on <date>"
 *   LAPSED    expiry in [now - 14 days, now)  → "access ended on <date>"
 *
 * Signal choice, stated honestly. We read `users.tier` +
 * `users.tier_expires_at` as they arrive through /api/auth/me (the
 * live-refreshed hook `useUserTier`), NOT a subscriptions lookup. That
 * covers the real data: the daily expiry sweep in
 * `/api/cron/trial-reminder` only downgrades rows that still have an
 * `active` subscription row, so lapsed Pro accounts in this database
 * keep `tier='pro'` with a past `tier_expires_at` (verified 2026-09-07
 * against production). The known gap: a user the sweep DID downgrade
 * loses both signals (tier→'free', expiry→null) and will not see the
 * lapsed prompt. That is a miss, never a wrong prompt.
 *
 * Deliberately NOT wired into `useAnnouncementGate`: that gate returns
 * null for paying users by design, which is precisely this banner's
 * audience. Frequency capping is a local per-day localStorage stamp
 * instead (see the component).
 */

/** How many days BEFORE expiry the prompt starts showing. */
export const RENEWAL_LEAD_DAYS = 7;
/** How many days AFTER expiry the prompt keeps showing. */
export const RENEWAL_LAPSED_DAYS = 14;

/** The tier the renewal button buys: the standard 3-month plan.
 *
 * Key is the legacy `first_3mo_27` (SoT §2: tier KEYS are data
 * identifiers and are NEVER renamed, so this one keeps its `_27`
 * suffix even though the plan costs €49). It is in the checkout route's
 * LIVE_TIERS allow-list. Never build a whop.com URL by hand; POST this
 * to /api/whop/checkout and follow the returned purchaseUrl.
 */
export const RENEWAL_TIER = "first_3mo_27";

export interface RenewalPromptInput {
  /** users.tier, as returned by /api/auth/me. */
  tier: "free" | "pro" | "admin";
  /** users.tier_expires_at (ISO) or null for a non-expiring grant. */
  tierExpiresAt: string | null;
  /** users.role — staff accounts never get a sales prompt. */
  role?: "user" | "admin";
  /** Injected for tests; defaults to now. */
  now?: Date;
}

export interface RenewalPromptDecision {
  /** ISO date (YYYY-MM-DD) the access ends / ended on. */
  endsOn: string;
  /** Whole days until expiry; 0 on the day itself, negative once past. */
  daysLeft: number;
  /** True once the expiry moment has passed. */
  lapsed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether to prompt this user to renew, and with what framing.
 * Returns null when no prompt is warranted — the only "show" answers
 * are a Pro-tier account with a real expiry inside one of the two
 * windows above.
 *
 * Pure and deterministic for a given `now`, so it is safe to call
 * during render and straightforward to test.
 */
export function evaluateRenewalPrompt(
  input: RenewalPromptInput
): RenewalPromptDecision | null {
  const { tier, tierExpiresAt, role = "user" } = input;
  const now = input.now ?? new Date();

  // Staff accounts are Pro by role, not by payment. Never sell to them.
  if (role === "admin") return null;
  // Only an account that HAS paid access can be prompted to renew it.
  // 'admin' tier is a manual grant, likewise not a renewal case.
  if (tier !== "pro") return null;
  // No expiry = a non-expiring grant. Nothing to renew.
  if (!tierExpiresAt) return null;

  const expiresMs = new Date(tierExpiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return null;

  const nowMs = now.getTime();
  const diffMs = expiresMs - nowMs;
  // Ceil so "any part of a day remaining" counts as a day left: an
  // expiry 3 hours from now reads as "1 day", not "0".
  const daysLeft = Math.ceil(diffMs / DAY_MS);

  if (diffMs >= 0) {
    // Upcoming: inside the lead window only.
    if (daysLeft > RENEWAL_LEAD_DAYS) return null;
  } else {
    // Lapsed: inside the grace window only, so an account that ended
    // months ago is not nagged forever.
    const daysSince = Math.floor(-diffMs / DAY_MS);
    if (daysSince > RENEWAL_LAPSED_DAYS) return null;
  }

  return {
    endsOn: new Date(expiresMs).toISOString().slice(0, 10),
    daysLeft,
    lapsed: diffMs < 0,
  };
}
