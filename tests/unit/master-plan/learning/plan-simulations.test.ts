import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "@/lib/master-learning/plan-target";
import { MIN_GAP_DAYS, pickSimulationDays } from "@/lib/master-learning/plan-simulations";

function plan(totalDays: number) {
  const startDay = "2026-10-12";
  const examDate = addDays(startDay, totalDays);
  // Consolidation is the last 30 percent of the plan (studyPlan.ts policy).
  const consolidationStart = addDays(examDate, -Math.ceil(totalDays * 0.3));
  return { startDay, examDate, consolidationStart, presetId: "kenntnispruefung" };
}

describe("plan simulations", () => {
  it("a 60 day plan returns at least 2 simulation days inside the consolidation window, spaced", () => {
    const p = plan(60);
    const days = pickSimulationDays(p);
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(days.map((d) => d.offsetDays)).toEqual([14, 7, 3]);
    for (const d of days) {
      expect(d.day >= p.consolidationStart).toBe(true);
      expect(d.day < p.examDate).toBe(true);
      expect(d.presetId).toBe("kenntnispruefung");
    }
    for (let i = 1; i < days.length; i++) {
      expect(daysBetween(days[i - 1].day, days[i].day)).toBeGreaterThanOrEqual(MIN_GAP_DAYS);
    }
  });

  it("a 30 day plan still gets 2 via the fallback offsets", () => {
    const days = pickSimulationDays(plan(30));
    expect(days.map((d) => d.offsetDays)).toEqual([7, 4]);
  });

  it("a 45 day plan uses T-14 and T-7", () => {
    expect(pickSimulationDays(plan(45)).map((d) => d.offsetDays)).toEqual([14, 7]);
  });

  it("a 20 day plan returns none", () => {
    expect(pickSimulationDays(plan(20))).toEqual([]);
  });

  it("never schedules on the exam day or before the plan starts", () => {
    for (const total of [30, 31, 45, 59, 60, 90, 200]) {
      const p = plan(total);
      for (const d of pickSimulationDays(p)) {
        expect(d.day).not.toBe(p.examDate);
        expect(d.day >= p.startDay).toBe(true);
      }
    }
  });
});
