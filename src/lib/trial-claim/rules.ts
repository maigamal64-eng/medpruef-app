/**
 * One-time 3-day full-access claim for existing accounts
 * (a-reverse-trial-claim), pure rules.
 *
 * The reverse trial (a-pricing-v2) starts by itself only for accounts created
 * after REVERSE_TRIAL_SINCE. This claim lets an account created BEFORE that
 * instant take the same 3 days once, from a signed link in the release mail
 * or from a Home card. It is the same product, with the same walls:
 *
 *   - same grant: a dated `reverse_trial` subscriptions row (provider
 *     `trial`, amount 0) plus a dated users.tier 'pro'; never open-ended;
 *     the Mentor gets only the bounded trial taste (isTrialSub);
 *   - same identity walls: a linked Telegram id (a-trial-phone-gate, [name]
 *     17 Oct: one trial per Telegram account; a confirmed email or the mail
 *     link's mailbox proof alone no longer suffices, it only adds the
 *     once-per-address wall),
 *     once per account, once per normalised address key, once per Telegram
 *     id (the trials table's unique indexes), at most
 *     REVERSE_TRIAL_MAX_PER_IP starts per network in 24 hours;
 *   - plus the claim's own audience rule: the account never paid (no
 *     subscription row that moved money, refunded rows included) and never
 *     had any trial (no trials row of any kind and no trial subscription
 *     row, the card trial included), is not admin, not banned and has no
 *     running Pro access.
 *
 * These are exactly the conditions the release-mail claim block states
 * ("keine Karte und kein Abo, einmal pro Person, danach die kostenlose
 * Probe"). Claiming never creates a checkout session and never calls Whop.
 */
import { rowPaidCents, type LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { CARD_TRIAL_TIERS } from "@/lib/card-trial";

/** Subscription tiers that record a trial (card trial, retired no-card trial, reverse trial). */
export const TRIAL_SUBSCRIPTION_TIERS: ReadonlySet<string> = new Set([...CARD_TRIAL_TIERS, "notes_free_trial", "reverse_trial"]);

export type ClaimReason =
  | "eligible"
  | "resume"
  | "in_progress"
  | "running"
  | "admin"
  | "banned"
  | "new_account"
  | "live_access"
  | "paid"
  | "trial_used"
  | "unverified"
  | "telegram_required";

export interface ClaimUser {
  role: string | null;
  tier: string | null;
  tierExpiresAt: string | null;
  createdAt: string | null;
  isBanned: boolean;
}

export interface ClaimTrialRow {
  kind: string | null;
  startedAt?: string | null;
  expiresAt: string | null;
}

export interface ClaimInput {
  user: ClaimUser;
  subs: LearnerSubscriptionRow[];
  /** This account's trials row, if any. */
  ownTrial: ClaimTrialRow | null;
  /** Another account already used this address key or Telegram id. */
  identityUsed: boolean;
  /** A verified identity exists (email key or Telegram id). */
  verified: boolean;
  /**
   * a-trial-phone-gate ([name] 17 Oct, trial-phone-backed): a Telegram id is
   * linked to the account. Required for every claim, one per Telegram account.
   */
  telegramLinked: boolean;
  /** REVERSE_TRIAL_SINCE: accounts created at or after it get the automatic trial instead. */
  since: Date;
  now?: Date;
}

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

export function isTrialSubscription(s: Pick<LearnerSubscriptionRow, "tier" | "payment_provider">): boolean {
  return TRIAL_SUBSCRIPTION_TIERS.has(s.tier ?? "") || s.payment_provider === "trial";
}

export function hasLiveAccess(u: Pick<ClaimUser, "tier" | "tierExpiresAt">, now: Date): boolean {
  if (u.tier === "admin") return true;
  if (u.tier !== "pro") return false;
  if (!u.tierExpiresAt) return true;
  const end = ms(u.tierExpiresAt);
  return !Number.isFinite(end) || end > now.getTime();
}

/** True when this account's own claimed trial runs now (a repeated claim answers success). */
export function ownTrialRunning(i: Pick<ClaimInput, "user" | "ownTrial">, now: Date): boolean {
  if (!i.ownTrial || i.ownTrial.kind !== "reverse") return false;
  const end = ms(i.ownTrial.expiresAt);
  return Number.isFinite(end) && end > now.getTime() && hasLiveAccess(i.user, now);
}

/**
 * This account's own claim lock exists and has not ended, but the grant did
 * not finish (a write timed out after committing, or the undo could not
 * remove it). The claim may be completed with the stored dates instead of
 * leaving a used lock without access.
 */
export function ownLockUnfinished(i: Pick<ClaimInput, "user" | "ownTrial">, now: Date): boolean {
  if (!i.ownTrial || i.ownTrial.kind !== "reverse") return false;
  const end = ms(i.ownTrial.expiresAt);
  return Number.isFinite(end) && end > now.getTime() && !hasLiveAccess(i.user, now);
}

/**
 * A lock younger than this may still belong to a request in flight (route
 * maxDuration 30 s plus margin), so it is never resumed: two parallel presses
 * cannot both grant and one undo the other's rows (review N1).
 */
export const RESUME_AFTER_MS = 90_000;

export function ownLockInFlight(i: Pick<ClaimInput, "ownTrial">, now: Date): boolean {
  const started = ms(i.ownTrial?.startedAt ?? null);
  return !Number.isFinite(started) || started > now.getTime() - RESUME_AFTER_MS;
}

/**
 * The claim decision. Order matters only for the reason shown: the most
 * specific wall first. The server repeats the single-use part atomically
 * (the trials insert hits a unique index).
 */
export function claimEligibility(i: ClaimInput): { eligible: boolean; reason: ClaimReason } {
  const now = i.now ?? new Date();
  const no = (reason: ClaimReason) => ({ eligible: false, reason });
  if (i.user.role === "admin" || i.user.tier === "admin") return no("admin");
  if (i.user.isBanned) return no("banned");
  if (ownTrialRunning(i, now)) return no("running");
  const created = ms(i.user.createdAt);
  if (!Number.isFinite(created) || created >= i.since.getTime()) return no("new_account");
  if (i.subs.some((s) => rowPaidCents(s) > 0)) return no("paid");
  if (ownLockUnfinished(i, now)) {
    // Only this lock's own reverse_trial row may exist; any other trial still blocks.
    if (i.subs.some((s) => isTrialSubscription(s) && s.tier !== "reverse_trial")) return no("trial_used");
    if (ownLockInFlight(i, now)) return no("in_progress");
    // a-trial-phone-gate: a resume only finishes a lock that already passed every wall
    // when it was written (locks written from this job on carry a Telegram id).
    return { eligible: true, reason: "resume" };
  }
  if (i.ownTrial || i.identityUsed || i.subs.some(isTrialSubscription)) return no("trial_used");
  if (hasLiveAccess(i.user, now)) return no("live_access");
  if (!i.telegramLinked) return no("telegram_required");
  if (!i.verified) return no("unverified");
  return { eligible: true, reason: "eligible" };
}
