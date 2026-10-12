/**
 * Whop id shapes (a-stability, 2026-10-12). A MEMBERSHIP (mem_...) is the
 * subscription and the only valid subscriptions.whop_membership_id pin. A
 * MEMBER (mber_...) is the buyer's per-company record; code before 2 Oct
 * stored it as the pin (Sentry JAVASCRIPT-NEXTJS-13). Pure, client-safe.
 */
export const WHOP_MEMBERSHIP_ID_RE = /^mem_[A-Za-z0-9]+$/;
export const WHOP_MEMBER_ID_RE = /^mber_[A-Za-z0-9]+$/;

export function isWhopMembershipId(value: unknown): value is string {
  return typeof value === "string" && WHOP_MEMBERSHIP_ID_RE.test(value);
}

/** The value when it is a real membership id, otherwise null (never a member id). */
export function whopMembershipIdOrNull(value: unknown): string | null {
  return isWhopMembershipId(value) ? value : null;
}

export function isWhopMemberId(value: unknown): value is string {
  return typeof value === "string" && WHOP_MEMBER_ID_RE.test(value);
}

/**
 * membership.trial_ending_soon: the membership the signal is about. Only a
 * mem_ id from membership_id, the embedded membership or the event's own id
 * (the membership object itself); `member.id` is the MEMBER and never used.
 */
export function trialEndingMembershipId(data: unknown): string | null {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const membership = d.membership && typeof d.membership === "object" ? (d.membership as Record<string, unknown>) : {};
  return whopMembershipIdOrNull(d.membership_id)
    ?? whopMembershipIdOrNull(membership.id)
    ?? whopMembershipIdOrNull(typeof d.membership === "string" ? d.membership : null)
    ?? whopMembershipIdOrNull(d.id);
}
