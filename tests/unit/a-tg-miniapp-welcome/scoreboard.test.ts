import { describe, expect, it } from "vitest";
import { scoreRow, tgScoreboard, type TgLearner } from "@/lib/tg-welcome/scoreboard";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const SINCE = Date.parse("2026-11-05T23:00:00Z");

function learner(over: Partial<TgLearner> & { signupDay: string }): TgLearner {
  return {
    signupAt: Date.parse(`${over.signupDay}T10:00:00Z`),
    telegramOnly: true,
    viaWelcome: false,
    named48h: false,
    examDateNow: false,
    answersByDay: {},
    checkoutWithin14d: false,
    ...over,
  };
}

describe("tg scoreboard", () => {
  it("counts named, day-0 answers, day-2 return and checkout with ended windows only", () => {
    const xs = [
      learner({ signupDay: "2026-11-01", named48h: true, examDateNow: true, answersByDay: { "2026-11-01": 12, "2026-11-02": 3 }, checkoutWithin14d: true }),
      learner({ signupDay: "2026-11-10", answersByDay: { "2026-11-10": 2 } }),
      learner({ signupDay: "2026-11-19", answersByDay: {} }),
    ];
    const r = scoreRow("g", xs, "2026-11-20", NOW);
    expect(r).toMatchObject({ signups: 3, named_48h: 1, exam_date_now: 1, day0_answers_median: 2, day0_10plus: 1, day0_zero: 1 });
    expect(r.day2_eligible).toBe(2); // 19 Nov has not reached day 3 yet
    expect(r.returned_day2).toBe(1);
    expect(r.checkout_eligible).toBe(1); // only the 1 Nov signup is 14 days old
    expect(r.checkout_14d).toBe(1);
  });

  it("splits baseline (120 days before --since) from current, by arrival and Telegram-only", () => {
    const xs = [
      learner({ signupDay: "2026-06-01" }), // older than the baseline window
      learner({ signupDay: "2026-10-01", telegramOnly: false }),
      learner({ signupDay: "2026-10-20" }),
      learner({ signupDay: "2026-11-10", viaWelcome: true }),
      learner({ signupDay: "2026-11-11", telegramOnly: false }),
    ];
    const rows = Object.fromEntries(tgScoreboard({ learners: xs, sinceMs: SINCE, today: "2026-11-20", nowMs: NOW }).map((r) => [r.group, r.signups]));
    expect(rows).toEqual({
      baseline_120d: 2,
      baseline_120d_telegram_only: 1,
      current: 2,
      current_telegram_only: 1,
      current_via_welcome: 1,
      current_not_via_welcome: 1,
    });
  });

  it("an empty group has a null median", () => {
    expect(scoreRow("e", [], "2026-11-20", NOW).day0_answers_median).toBeNull();
  });
});
