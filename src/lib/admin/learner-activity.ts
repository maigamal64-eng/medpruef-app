/**
 * learner-activity: what counts as "the learner did something" for admin
 * last-active, status and segments (ADM-07 option A, pick-admin-07).
 *
 *   Last active = the latest answer, learner event or session start.
 *   Never users.updated_at (the 7 Sep 2026 bulk update stamped 133 of 181
 *   learners), and never events written by webhooks, crons or admins on the
 *   learner's behalf.
 *
 * The SQL mirror lives in admin_user_directory_v2
 * (supabase/migrations/20261203090000_a16_admin_people.sql); keep the two
 * lists identical. A unit test compares them.
 */

/** Event type prefixes written by webhooks, crons and reminder senders. */
export const SYSTEM_EVENT_PREFIXES = [
  "whop_",
  "nowpayments_",
  "cron_",
  "subscription_",
  "trial_reminder",
  "trial_precharge",
] as const;

/** Exact event types written by admins or server-side bookkeeping. */
export const SYSTEM_EVENT_TYPES = [
  "trial_expired",
  "puyp_extension_granted",
  "puyp_attempt_rejected",
  "referral_reward",
  "referral_first_qualify_email_sent",
  "referral_qualify_insert",
  "referral_qualify_update",
  "referral_qualify_unexpected",
  "referral_reverse_update",
  "referral_reverse_unexpected",
] as const;

export function isSystemEvent(eventType: string | null | undefined): boolean {
  const t = (eventType ?? "").trim();
  if (!t) return true;
  if ((SYSTEM_EVENT_TYPES as readonly string[]).includes(t)) return true;
  return SYSTEM_EVENT_PREFIXES.some((p) => t.startsWith(p));
}

export const LAST_ACTIVE_BASIS =
  "Last active is the latest answer, learner event or session start. Profile edits, payments, webhooks, crons and admin actions do not count.";

/** Latest of the given ISO stamps, or null when none is a valid date. */
export function latestStamp(stamps: Array<string | null | undefined>): string | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const s of stamps) {
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isFinite(t) && t > best) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

export type ActivityStatus = "active" | "recent" | "cooling" | "dormant" | "no_activity";

export function activityStatus(lastActive: string | null, now: Date = new Date()): ActivityStatus {
  if (!lastActive) return "no_activity";
  const days = (now.getTime() - Date.parse(lastActive)) / 86_400_000;
  if (days <= 1) return "active";
  if (days <= 7) return "recent";
  if (days <= 30) return "cooling";
  return "dormant";
}
