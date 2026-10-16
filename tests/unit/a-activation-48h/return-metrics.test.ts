import { describe, expect, it } from "vitest";
import { day0Bucket, dayOffset, learnerReturn, returnBySegment, type CohortLearner } from "@/lib/activation/return-metrics";

const base = (over: Partial<CohortLearner>): CohortLearner => ({
  signupDay: "2026-10-01", segment: "stichprobentest", lang: "de", hasDate: false, onboarded: true, telegram: false, answersByDay: {}, ...over,
});

describe("return definitions", () => {
  it("counts days from the signup day", () => {
    expect(dayOffset("2026-10-01", "2026-10-03")).toBe(2);
    expect(dayOffset("2026-10-24", "2026-10-26")).toBe(2); // across the DST change
  });

  it("day 2 is day 1 or 2; week 1 is days 3 to 7", () => {
    expect(learnerReturn(base({ answersByDay: { "2026-10-01": 12, "2026-10-03": 1 } }))).toEqual({ answersDay0: 12, returnedDay2: true, returnedWeek1: false, activeDaysWeek1: 2 });
    expect(learnerReturn(base({ answersByDay: { "2026-10-01": 3, "2026-10-08": 5 } }))).toEqual({ answersDay0: 3, returnedDay2: false, returnedWeek1: true, activeDaysWeek1: 1 });
    expect(learnerReturn(base({ answersByDay: { "2026-10-09": 5 } })).returnedWeek1).toBe(false);
    expect(day0Bucket(0)).toBe("0");
    expect(day0Bucket(9)).toBe("1-9");
    expect(day0Bucket(10)).toBe("10-29");
    expect(day0Bucket(30)).toBe("30+");
  });

  it("denominators wait until the day has ended", () => {
    const rows = returnBySegment([
      base({ signupDay: "2026-10-01", answersByDay: { "2026-10-01": 10, "2026-10-02": 2 } }),
      base({ signupDay: "2026-10-10", segment: "vienna_sip" }), // day 2 over, week 1 not
      base({ signupDay: "2026-10-12" }), // day 2 not over: left out
    ], "2026-10-13");
    const all = rows.find((r) => r.group === "all")!;
    expect(all).toMatchObject({ n_day2: 2, returned_day2: 1, n_week1: 1, returned_week1: 0, answered_day0: 1, ten_day0: 1, avg_active_days_week1: 2 });
    const sip = rows.find((r) => r.group === "segment" && r.value === "vienna_sip")!;
    expect(sip).toMatchObject({ n_day2: 1, n_week1: 0, avg_active_days_week1: null });
    expect(rows.find((r) => r.group === "day0_answers" && r.value === "10-29")?.returned_day2).toBe(1);
  });

  it("reports activation steps once the path runs", () => {
    const rows = returnBySegment([base({ steps: ["starter_started", "first_win"], answersByDay: { "2026-10-02": 1 } })], "2026-10-20");
    expect(rows.find((r) => r.group === "starter_started" && r.value === "true")?.returned_day2).toBe(1);
    expect(rows.find((r) => r.group === "first_win_step" && r.value === "true")?.n_day2).toBe(1);
  });
});
