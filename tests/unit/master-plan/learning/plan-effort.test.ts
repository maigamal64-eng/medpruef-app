import { describe, expect, it } from "vitest";
import {
  MINUTES_PER_QUESTION,
  TOO_MUCH_PER_DAY,
  effortSentence,
  effortVerdict,
  minutesPerDay,
  planEffort,
  requiredPerDay,
  targetShare,
} from "@/lib/master-learning/plan-effort";

describe("plan effort", () => {
  it("7,500 unseen and 42 days is too_much at 179 per day", () => {
    const e = planEffort(7500, 42);
    expect(e.questionsPerDay).toBe(179);
    expect(e.verdict).toBe("too_much");
  });

  it("150 unseen and 150 days fits", () => {
    const e = planEffort(150, 150);
    expect(e.questionsPerDay).toBe(1);
    expect(e.verdict).toBe("fits");
  });

  it("boundary at exactly 60 per day: 60 is not too_much, 61 is", () => {
    expect(effortVerdict(TOO_MUCH_PER_DAY)).toBe("tight");
    expect(effortVerdict(TOO_MUCH_PER_DAY + 1)).toBe("too_much");
    expect(requiredPerDay(600, 10)).toBe(60);
    expect(requiredPerDay(601, 10)).toBe(61);
  });

  it("uses the learner's daily goal: tight above the goal, too_much above twice the goal", () => {
    expect(effortVerdict(20, 20)).toBe("fits");
    expect(effortVerdict(21, 20)).toBe("tight");
    expect(effortVerdict(40, 20)).toBe("tight");
    expect(effortVerdict(41, 20)).toBe("too_much");
  });

  it("minutes use the named constant", () => {
    expect(MINUTES_PER_QUESTION).toBe(1.5);
    expect(minutesPerDay(40)).toBe(60);
  });

  it("handles zero unseen and zero days without dividing by zero", () => {
    expect(requiredPerDay(0, 0)).toBe(0);
    expect(requiredPerDay(10, 0)).toBe(10);
  });

  it("targetShare answers 'for 80 percent it would be about N per day'", () => {
    expect(targetShare({ sharePct: 80, pool: 1000, daysLeft: 40 })).toEqual({ questionsNeeded: 800, questionsPerDay: 20 });
    expect(targetShare({ sharePct: 80, pool: 1000, daysLeft: 40, alreadyCovered: 900 }).questionsPerDay).toBe(0);
  });

  it("sentences carry the numbers and no em or en dash", () => {
    for (const lang of ["de", "en"] as const) {
      for (const e of [planEffort(7500, 42), planEffort(900, 30), planEffort(150, 150)]) {
        const s = effortSentence(e, lang);
        expect(s).toContain(String(e.questionsPerDay));
        expect(s).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});
