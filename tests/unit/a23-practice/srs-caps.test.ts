import { describe, expect, it } from "vitest";
import { binaryNext, examCapDays, gradedNext, MAX_INTERVAL_DAYS } from "@/lib/master-learning/srs";

// pick-interval-limits A on both schedulers; mirrors srs_cap_interval in
// 20261222090000_a23_graded_review.sql (proved on PG16 by test:db:a23).
describe("a23 interval caps", () => {
  it("an exam date in the past never caps", () => {
    expect(examCapDays("2026-10-12", "2026-10-11")).toBeNull();
    expect(examCapDays("2026-10-12", "2026-10-12")).toBe(0);
    expect(gradedNext({ ease: 2.5, intervalDays: 30 }, 2, { todayIso: "2026-10-12", examDate: "2026-09-01" }).intervalDays).toBe(75);
  });
  it("binaryNext without options is the uncapped stored arithmetic", () => {
    expect(binaryNext({ ease: 2.9, intervalDays: 170 }, true).intervalDays).toBe(510);
  });
  it("binaryNext with options caps at 180 days and at the exam date minus two days", () => {
    expect(binaryNext({ ease: 2.9, intervalDays: 170 }, true, { todayIso: "2026-10-12" })).toMatchObject({ intervalDays: MAX_INTERVAL_DAYS, cappedBy: "max_interval" });
    expect(binaryNext({ ease: 2.5, intervalDays: 6 }, true, { todayIso: "2026-10-12", examDate: "2026-10-22" })).toMatchObject({ intervalDays: 8, cappedBy: "exam_date" });
    expect(binaryNext({ ease: 2.5, intervalDays: 10 }, true, { todayIso: "2026-10-12", examDate: "2026-09-01" }).intervalDays).toBe(26);
    expect(binaryNext(null, false, { todayIso: "2026-10-12", examDate: "2026-10-22" }).intervalDays).toBe(0);
  });
});
