/**
 * Monday scoreboard for the day-1 sitting ask (a-day1-sitting-ask). Pure
 * summary over rows the read-only script fetches: mailed against held out
 * (the 1 in 5 holdout), share of the cohort with a named future sitting and
 * share that opened checkout within 14 days of registration.
 *
 * Honest limits, printed with the numbers: users.exam_date has no history, so
 * "named" is the state at read time (a cohort read at 48 to 72 hours is the
 * closest to "at 48 hours"; older cohorts drift upward in both arms), and a
 * cohort younger than 14 days has an immature checkout window.
 */
export interface ScoreUser {
  id: string;
  created_at: string;
  exam_date: string | null;
}

export interface ScoreEvents {
  /** user id -> event type -> earliest created_at (ms). */
  byUser: Map<string, Map<string, number>>;
  /** user id -> earliest checkout open (ms). */
  checkoutOpen: Map<string, number>;
}

export interface ArmSummary {
  arm: "mailed" | "held_out";
  n: number;
  named_future_sitting: number;
  named_share: number | null;
  link_opened: number;
  sitting_set_from_mail: number;
  checkout_open_14d: number;
  checkout_share: number | null;
  /** Users whose 14-day window has not closed at read time. */
  immature_checkout: number;
}

const DAY_MS = 86_400_000;
const share = (a: number, n: number) => (n > 0 ? Math.round((a / n) * 1000) / 10 : null);

export function summarizeArm(arm: ArmSummary["arm"], users: ScoreUser[], ev: ScoreEvents, nowMs: number, today: string): ArmSummary {
  let named = 0, opened = 0, set = 0, checkout = 0, immature = 0;
  for (const u of users) {
    if (u.exam_date && u.exam_date >= today) named += 1;
    const types = ev.byUser.get(u.id);
    if (types?.has("sitting_link_open")) opened += 1;
    if (types?.has("sitting_set")) set += 1;
    const created = Date.parse(u.created_at);
    const open = ev.checkoutOpen.get(u.id);
    if (open !== undefined && open - created <= 14 * DAY_MS) checkout += 1;
    if (nowMs - created < 14 * DAY_MS) immature += 1;
  }
  return {
    arm, n: users.length,
    named_future_sitting: named, named_share: share(named, users.length),
    link_opened: opened, sitting_set_from_mail: set,
    checkout_open_14d: checkout, checkout_share: share(checkout, users.length),
    immature_checkout: immature,
  };
}
