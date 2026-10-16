/**
 * Monday scoreboard for Telegram signups (a-tg-miniapp-welcome). Pure; the
 * reader is scripts/tg-welcome/scoreboard.ts. Counts only, never an id.
 *
 * Cohorts: Telegram signups (a telegram_register activity row, or a Telegram
 * id without an email address) split by period (baseline = the 120 days before
 * --since, current = since --since, the flag switch-on day) and by arrival
 * (via_welcome = a tg_welcome_open event within 48 hours of signup).
 *
 * Definitions (Europe/Vienna days, day 0 = the signup day):
 *  - named_48h: a sitting_set event with named:true within 48 hours, or (no
 *    such event existed before the flag) onboarding completed within 48 hours
 *    with an onboarding examDate that names an official sitting. users.exam_date
 *    has no set-at time, so exam_date_now is reported beside it (the "5 of 20"
 *    number of the 15 Oct baseline).
 *  - answers on day 0, returned on day 2 (an answer on day 1 or 2): the
 *    activation definitions (src/lib/activation/return-metrics.ts).
 *  - checkout_14d: a payment_events checkout_session_created row of the
 *    learner within 14 days of signup. Denominators count only learners whose
 *    window has ended (day 2 ended, 14 days passed).
 */
import { learnerReturn } from "@/lib/activation/return-metrics";

export const TG_BASELINE_DAYS = 120;

export interface TgLearner {
  signupAt: number;
  signupDay: string;
  telegramOnly: boolean;
  viaWelcome: boolean;
  named48h: boolean;
  examDateNow: boolean;
  answersByDay: Readonly<Record<string, number>>;
  checkoutWithin14d: boolean;
}

export interface TgScoreRow {
  group: string;
  signups: number;
  named_48h: number;
  exam_date_now: number;
  day0_answers_median: number | null;
  day0_10plus: number;
  day0_zero: number;
  day2_eligible: number;
  returned_day2: number;
  checkout_eligible: number;
  checkout_14d: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function scoreRow(group: string, learners: readonly TgLearner[], today: string, nowMs: number): TgScoreRow {
  const day0: number[] = [];
  let day2Eligible = 0;
  let returned = 0;
  let checkoutEligible = 0;
  let checkout = 0;
  for (const l of learners) {
    const r = learnerReturn({ signupDay: l.signupDay, segment: "", lang: "", hasDate: false, onboarded: false, telegram: true, answersByDay: l.answersByDay });
    day0.push(r.answersDay0);
    const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${l.signupDay}T00:00:00Z`)) / 86_400_000);
    if (ageDays >= 3) {
      day2Eligible++;
      if (r.returnedDay2) returned++;
    }
    if (nowMs - l.signupAt >= 14 * 86_400_000) {
      checkoutEligible++;
      if (l.checkoutWithin14d) checkout++;
    }
  }
  return {
    group,
    signups: learners.length,
    named_48h: learners.filter((l) => l.named48h).length,
    exam_date_now: learners.filter((l) => l.examDateNow).length,
    day0_answers_median: median(day0),
    day0_10plus: day0.filter((n) => n >= 10).length,
    day0_zero: day0.filter((n) => n <= 0).length,
    day2_eligible: day2Eligible,
    returned_day2: returned,
    checkout_eligible: checkoutEligible,
    checkout_14d: checkout,
  };
}

/** Rows per period, then per arrival and per Telegram-only inside the current period. */
export function tgScoreboard(args: { learners: readonly TgLearner[]; sinceMs: number; today: string; nowMs: number }): TgScoreRow[] {
  const { learners, sinceMs, today, nowMs } = args;
  const baseline = learners.filter((l) => l.signupAt < sinceMs && l.signupAt >= sinceMs - TG_BASELINE_DAYS * 86_400_000);
  const current = learners.filter((l) => l.signupAt >= sinceMs);
  const row = (g: string, xs: readonly TgLearner[]) => scoreRow(g, xs, today, nowMs);
  return [
    row("baseline_120d", baseline),
    row("baseline_120d_telegram_only", baseline.filter((l) => l.telegramOnly)),
    row("current", current),
    row("current_telegram_only", current.filter((l) => l.telegramOnly)),
    row("current_via_welcome", current.filter((l) => l.viaWelcome)),
    row("current_not_via_welcome", current.filter((l) => !l.viaWelcome)),
  ];
}
