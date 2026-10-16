/**
 * Who may see an offer after saving a sitting (a-sitting-one-tap). Pure.
 *
 * Never to current payers, comps, admins, staff or test accounts, banned
 * accounts or do-not-contact addresses (any active mail_suppression row
 * blocking marketing; an unreadable list counts as blocked, fail closed).
 *
 *   planFit     the plan that fits the sitting (pricing v2 only). Allowed
 *               without live access, or when the only live access is a
 *               trial (a trialist is neither payer nor comp).
 *   trialOffer  the one-time 3-day claim (TRIAL_CLAIM_ENABLED). Only for
 *               never-paid, never-comped accounts: no subscriptions row at
 *               all (no paid, manual, trial or refunded row), no dated
 *               access ever (users.tier_expires_at empty) and tier free.
 *               The claim rules (trial-claim/rules.ts) then decide too.
 */
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { rowPaidCents, type LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { hasLiveAccess, isTrialSubscription } from "@/lib/trial-claim/rules";

export interface AudienceUser {
  email: string | null;
  role: string | null;
  tier: string | null;
  tierExpiresAt: string | null;
  isBanned: boolean;
}

export interface AudienceInput {
  user: AudienceUser;
  subs: LearnerSubscriptionRow[];
  /** true = blocked for marketing, false = clear, null = unknown (blocked). */
  suppressed: boolean | null;
  now?: Date;
}

export interface Audience {
  planFit: boolean;
  trialOffer: boolean;
  reason: "ok" | "admin_staff" | "banned" | "do_not_contact" | "current_access";
}

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

function rowLive(s: LearnerSubscriptionRow, now: Date): boolean {
  if (s.status !== "active") return false;
  const end = ms(s.expires_at);
  return !Number.isFinite(end) || end > now.getTime();
}

/**
 * A trial row that never moved money. A converted card trial keeps its tier
 * (notes_pro_trial) while Whop renewals extend the row with a positive
 * amount and payment history (reviewer P1), so the tier alone is not enough.
 */
function unpaidTrialRow(s: LearnerSubscriptionRow): boolean {
  if (!isTrialSubscription(s)) return false;
  if (rowPaidCents(s) > 0 || (s.amount_cents ?? 0) > 0) return false;
  return !(s.granted_payment_ids ?? []).some((e) => (e?.amount_cents ?? 0) > 0);
}

/**
 * Live access that only a running, unpaid trial row explains: every live row
 * is such a trial, and the account's dated access ends no later than the
 * latest of them (an open-ended or longer access is a comp or a payer).
 */
export function trialOnlyAccess(subs: LearnerSubscriptionRow[], tierExpiresAt: string | null, now: Date): boolean {
  const live = subs.filter((s) => rowLive(s, now));
  if (live.length === 0 || !live.every(unpaidTrialRow)) return false;
  const userEnd = ms(tierExpiresAt);
  const trialEnd = Math.max(...live.map((s) => ms(s.expires_at)).filter(Number.isFinite));
  return Number.isFinite(userEnd) && Number.isFinite(trialEnd) && userEnd <= trialEnd + 60_000;
}

export function offerAudience(i: AudienceInput): Audience {
  const now = i.now ?? new Date();
  const no = (reason: Audience["reason"]): Audience => ({ planFit: false, trialOffer: false, reason });
  if (isStaffOrTestAccount({ email: i.user.email, role: i.user.role, tier: i.user.tier })) return no("admin_staff");
  if (i.user.isBanned) return no("banned");
  if (i.suppressed !== false) return no("do_not_contact");
  const live = hasLiveAccess({ tier: i.user.tier, tierExpiresAt: i.user.tierExpiresAt }, now);
  if (live && !trialOnlyAccess(i.subs, i.user.tierExpiresAt, now)) return no("current_access");
  const neverPaidNeverComped = !live && i.subs.length === 0 && !i.user.tierExpiresAt && (i.user.tier ?? "free") === "free";
  return { planFit: true, trialOffer: neverPaidNeverComped, reason: "ok" };
}
