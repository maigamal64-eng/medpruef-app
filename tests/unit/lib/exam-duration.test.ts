import { describe, expect, it } from "vitest";
import { remainingSeconds } from "@/lib/examSession";
import { customDurationS, formatDurationLabel, planRun, UNTIMED_MAX_QUESTIONS, daysUntil, cappedDwell } from "@/lib/exam-run";
import { PRACTICE_DURATION_S, resolveDuration, EXAM_PRESETS } from "@/lib/master-exam";
import { EXAM_FORMAT_DATA } from "@/lib/exam-formats";

describe("exam durations (FMT-05, UX-EXM-17)", () => {
  it("no official SIP or SPT duration is recorded, so every preset runs its practice clock", () => {
    for (const s of EXAM_FORMAT_DATA.sittings) {
      const d = resolveDuration(EXAM_PRESETS.kp_full, EXAM_FORMAT_DATA.sittings, s.date);
      expect(d.kind).toBe("practice");
    }
    expect(planRun({ examSource: "kenntnispruefung", part: "all" }).durationS).toBe(PRACTICE_DURATION_S);
  });

  it("custom runs use 1.5 minutes per question, at least 10 minutes, never above the full run", () => {
    expect(customDurationS(10)).toBe(900);
    expect(customDurationS(4)).toBe(600);
    expect(customDurationS(400)).toBe(PRACTICE_DURATION_S);
  });

  it("untimed is offered only for small custom runs", () => {
    expect(planRun({ examSource: "kenntnispruefung", part: "custom", customCount: 20, untimed: true })).toMatchObject({ untimed: true, durationS: 0 });
    expect(planRun({ examSource: "kenntnispruefung", part: "custom", customCount: UNTIMED_MAX_QUESTIONS + 1, untimed: true }).untimed).toBe(false);
  });

  it("a resumed run keeps its own stored clock", () => {
    const startedAt = Date.now() - 30 * 60_000;
    expect(remainingSeconds(startedAt, 3600)).toBeGreaterThan(29 * 60);
    expect(remainingSeconds(startedAt, 3600)).toBeLessThanOrEqual(30 * 60);
  });

  it("labels and day counts", () => {
    expect(formatDurationLabel(4 * 3600, "de")).toBe("4 Std.");
    expect(formatDurationLabel(5400, "en")).toBe("1 h 30 min");
    expect(daysUntil("2026-10-20", new Date("2026-10-12T10:00:00Z"))).toBe(8);
    expect(daysUntil(null)).toBeNull();
  });

  it("dwell time caps time away at 30 minutes per question", () => {
    expect(cappedDwell([[0, 0], [1, 60_000]], 60_000 + 3 * 3600_000)).toEqual({ 0: 60, 1: 1800 });
  });
});
