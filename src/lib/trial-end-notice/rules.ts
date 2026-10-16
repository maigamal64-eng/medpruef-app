/**
 * Reverse-trial end notice (a-reverse-trial-end-mail), pure rules.
 *
 * One notice per account ever, about 24 hours before a trials row of kind
 * 'reverse' ends. The typical trialist is active two days and gone by day 3,
 * and the in-app trial-end card (a-trial-end-decision) cannot reach someone
 * who does not open the app. Never for an account that already paid, holds
 * access of its own, opened a checkout since the trial began (that learner
 * has the checkout-resume card), or is staff, banned, excluded or on the
 * do-not-contact list.
 *
 * Mail class: marketing (it points to a plan), so it obeys the do-not-contact
 * list, carries the Stopp line and counts against the learner mail cap.
 * Holdout: one account in five is decided but never contacted, so the
 * Monday scoreboard can compare day-3 conversion with and without the notice.
 */
import { createHash } from "node:crypto";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { trialEndState } from "@/lib/trial-end/rules";
import { resumeExcludedIds } from "@/lib/checkout-resume";

const HOUR_MS = 3_600_000;
/** The sweep reaches trials ending between 1 and 24 hours from now (it runs daily, so each trial is in range once). */
export const NOTICE_MIN_HOURS = 1;
export const NOTICE_MAX_HOURS = 24;
export const HOLDOUT_ONE_IN = 5;
/** Learner mail cap: no second learner mail inside this window. */
export const MAIL_CAP_HOURS = 72;

export const NOTICE_CLAIM_PROVIDER = "trial_end_notice";
export const NOTICE_SENT = "trial_end_notice_sent";
export const NOTICE_HELD = "trial_end_notice_held";

/**
 * The one list of learner-mail events the cap reads. A new learner mail (day-1
 * ask, B1, B3, ...) adds its sent-event name here so none of them collide.
 */
export const LEARNER_MAIL_EVENT_TYPES: readonly string[] = [
  "trial_reminder_email_sent",
  NOTICE_SENT,
  // a-release-int-7: the day-1 sitting ask (a-day1-sitting-ask) lands 24 to
  // 72 h after an email registration, inside the reverse trial's 3 days.
  "day1_ask_sent",
];

export type NoticeChannel = "email" | "telegram";
export type HoldReason =
  | "holdout" | "mail_cap" | "do_not_contact" | "dry_run"
  | "telegram_blocked" | "no_channel" | "sitting_week";
export type SkipReason =
  | "excluded" | "staff" | "banned" | "has_access" | "not_in_window" | "checkout_opened" | "no_trial" | "already_decided";

export type NoticeDecision =
  | { act: "skip"; reason: SkipReason }
  | { act: "hold"; reason: "holdout" | "mail_cap" | "no_channel" | "sitting_week" | "do_not_contact" }
  | { act: "send"; channel: NoticeChannel };

/** Stable 1-in-5 holdout from the account id alone. */
export function inHoldout(userId: string): boolean {
  const n = createHash("sha256").update(`trial-end-notice:${userId.toLowerCase()}`).digest().readUInt32BE(0);
  return n % HOLDOUT_ONE_IN === 0;
}

export interface NoticeAccount {
  id: string;
  role: string | null;
  tier: string | null;
  tierExpiresAt: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  isBanned: boolean;
  telegramChatConfirmed: boolean;
}

export interface NoticeInput {
  account: NoticeAccount;
  trial: { startedAt: string; endsAt: string } | null;
  /** A subscription row of this account ever moved money (refunds included). */
  everPaid: boolean;
  /** A checkout_session_created payment event at or after the trial start. */
  checkoutSinceStart: boolean;
  /** A learner mail or study reminder inside the cap window (any channel). */
  mailInCap: boolean;
  /** Today falls in the learner's own sitting week: promotion pauses (journey section 7). */
  sittingWeek?: boolean;
  /** A claim already exists for this account. */
  decidedBefore: boolean;
  telegramEnabled: boolean;
  excluded?: ReadonlySet<string>;
  now: Date;
}

export function decideNotice(i: NoticeInput): NoticeDecision {
  const a = i.account;
  if (i.decidedBefore) return { act: "skip", reason: "already_decided" };
  if (!i.trial) return { act: "skip", reason: "no_trial" };
  if ((i.excluded ?? resumeExcludedIds()).has(a.id.toLowerCase())) return { act: "skip", reason: "excluded" };
  if (isStaffOrTestAccount({ role: a.role, tier: a.tier, email: a.email })) return { act: "skip", reason: "staff" };
  if (a.isBanned) return { act: "skip", reason: "banned" };
  const end = Date.parse(i.trial.endsAt);
  const hours = (end - i.now.getTime()) / HOUR_MS;
  if (!(hours >= NOTICE_MIN_HOURS && hours <= NOTICE_MAX_HOURS)) return { act: "skip", reason: "not_in_window" };
  // Reuses the trial-end card's rule: paid, admin, permanent Pro or own access past the trial end read "none".
  const state = trialEndState({
    trialEndsAt: i.trial.endsAt,
    everPaid: i.everPaid,
    user: { role: a.role, tier: a.tier, tierExpiresAt: a.tierExpiresAt },
    now: i.now,
  });
  if (i.everPaid || state !== "last_day") return { act: "skip", reason: "has_access" };
  if (i.checkoutSinceStart) return { act: "skip", reason: "checkout_opened" };

  const mailable = !!a.email && !!a.emailVerifiedAt;
  const channel: NoticeChannel | null = mailable ? "email" : i.telegramEnabled && a.telegramChatConfirmed ? "telegram" : null;
  if (!channel) return { act: "hold", reason: "no_channel" };
  if (i.sittingWeek) return { act: "hold", reason: "sitting_week" };
  if (inHoldout(a.id)) return { act: "hold", reason: "holdout" };
  if (i.mailInCap) return { act: "hold", reason: "mail_cap" };
  return { act: "send", channel };
}
