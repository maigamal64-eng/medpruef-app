import { describe, expect, it } from "vitest";
import { WEEKS_SHOWN, buildWeeklyProgress } from "@/lib/master-learning/weekly-progress";
import { countdownCopy } from "@/lib/master-learning/plan-copy";

// Monday 2026-10-12, 12:00 Vienna.
const NOW = new Date("2026-10-12T10:00:00Z");

describe("weekly progress", () => {
  it("returns 12 Monday-anchored weeks, oldest first", () => {
    const w = buildWeeklyProgress([], { now: NOW });
    expect(w).toHaveLength(WEEKS_SHOWN);
    expect(w[WEEKS_SHOWN - 1].weekStart).toBe("2026-10-12");
    expect(w[0].weekStart).toBe("2026-07-27");
    expect(new Date(`${w[3].weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("groups answered and correct like a SQL group-by over the same rows", () => {
    const rows = [
      { createdAt: "2026-10-12T08:00:00Z", isCorrect: true },
      { createdAt: "2026-10-11T20:00:00Z", isCorrect: false }, // Sunday: previous week
      { createdAt: "2026-10-06T08:00:00Z", isCorrect: true },
      { createdAt: "2026-10-05T23:00:00Z", isCorrect: true }, // Monday 01:00 Vienna: this-1 week
      { createdAt: "2026-01-01T08:00:00Z", isCorrect: true }, // outside the 12 weeks
      { createdAt: "2026-10-13T08:00:00Z", isCorrect: true }, // future
    ];
    const w = buildWeeklyProgress(rows, { now: NOW });
    expect(w[11]).toMatchObject({ answered: 1, correct: 1, accuracy: 1 });
    expect(w[10]).toMatchObject({ weekStart: "2026-10-05", answered: 3, correct: 2 });
    expect(w[10].accuracy).toBeCloseTo(2 / 3, 10);
    expect(w.reduce((n, b) => n + b.answered, 0)).toBe(4);
    expect(w[0].accuracy).toBeNull();
  });

  it("countdown copy", () => {
    expect(countdownCopy(34, "13. November", "de")).toBe("Noch 34 Tage bis zum 13. November");
    expect(countdownCopy(1, "x", "de")).toBe("Noch 1 Tag bis zum x");
    expect(countdownCopy(-1, "x", "en")).toBe("Your date has passed");
  });
});
