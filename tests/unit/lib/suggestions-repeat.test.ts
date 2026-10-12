import { describe, expect, it } from "vitest";
import {
  computeReportFixTimes,
  orderRepeatsFirst,
  percentile,
  repeatCounts,
  repeatOf,
  workingDaysBetween,
} from "@/lib/reports/report-metrics";

describe("TR-14 repeat reports", () => {
  it("marks the second report on one question as a repeat (2) and leaves single reports alone", () => {
    const counts = repeatCounts([{ question_id: 7 }, { question_id: 7 }, { question_id: 9 }, { question_id: null }]);
    expect(repeatOf(counts, 7)).toBe(2);
    expect(repeatOf(counts, 9)).toBeNull();
    expect(repeatOf(counts, 12)).toBeNull();
    expect(repeatOf(counts, null)).toBeNull();
  });

  it("counts reports of any status (a decided earlier report still makes the new one a repeat)", () => {
    const counts = repeatCounts([{ question_id: 3 }, { question_id: 3 }, { question_id: 3 }, { question_id: 3 }]);
    expect(repeatOf(counts, 3)).toBe(4);
  });

  it("orders repeats first, then newest", () => {
    const rows = [
      { id: 1, repeat_count: null, created_at: "2026-10-10T10:00:00Z" },
      { id: 2, repeat_count: 3, created_at: "2026-10-01T10:00:00Z" },
      { id: 3, repeat_count: null, created_at: "2026-10-11T10:00:00Z" },
      { id: 4, repeat_count: 2, created_at: "2026-10-05T10:00:00Z" },
    ];
    expect(orderRepeatsFirst(rows).map((r) => r.id)).toEqual([2, 4, 3, 1]);
  });
});

describe("TR-11 fix times", () => {
  it("nearest-rank percentile", () => {
    expect(percentile([], 90)).toBeNull();
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile(Array.from({ length: 10 }, (_, i) => i + 1), 90)).toBe(9);
  });

  it("counts Vienna working days and skips the weekend", () => {
    // Friday 2026-10-09 15:00 Vienna -> Monday 2026-10-12 09:00 Vienna = 1 working day.
    expect(workingDaysBetween("2026-10-09T13:00:00Z", Date.parse("2026-10-12T07:00:00Z"))).toBe(1);
    // Monday -> Thursday = 3 working days.
    expect(workingDaysBetween("2026-10-05T08:00:00Z", Date.parse("2026-10-08T08:00:00Z"))).toBe(3);
    expect(workingDaysBetween("2026-10-05T08:00:00Z", Date.parse("2026-10-05T09:00:00Z"))).toBe(0);
  });

  it("computes median, p90, the 3-working-day share, open-over-target and the wrong-key p90", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const s = computeReportFixTimes([
      { reason: "incorrect_answer", status: "approved", created_at: "2026-10-05T08:00:00Z", resolved_at: "2026-10-05T18:00:00Z" },
      { reason: "typo", status: "rejected", created_at: "2026-10-01T08:00:00Z", resolved_at: "2026-10-01T09:00:00Z" },
      { reason: "incorrect_answer", status: "approved", created_at: "2026-09-01T08:00:00Z", resolved_at: "2026-09-14T08:00:00Z" },
      { reason: "unclear", status: "pending", created_at: "2026-10-01T08:00:00Z", resolved_at: null },
      { reason: "unclear", status: "pending", created_at: "2026-10-12T08:00:00Z", resolved_at: null },
    ], now);
    expect(s.received).toBe(5);
    expect(s.decided).toBe(3);
    expect(s.median_hours).toBe(10);
    expect(s.p90_hours).toBe(312);
    expect(s.acknowledged_on_time).toBe(2);
    expect(s.open_over_target).toBe(1);
    expect(s.wrong_key).toEqual({ decided: 2, p90_hours: 312, target_hours: 168, on_target: false });
  });
});
