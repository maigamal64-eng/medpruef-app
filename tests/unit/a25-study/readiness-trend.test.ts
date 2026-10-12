import { describe, expect, it } from "vitest";
import { buildFieldReadiness, fieldState } from "@/lib/field-readiness";
import { buildExamTrend, fullRunKey, type TrendAttemptInput } from "@/lib/exam-trend";
import { VIENNA_EXAM_PARTS } from "@/lib/topics";

describe("CNT-42 field readiness", () => {
  it("59.9 percent is never at the mark; 60.0 is", () => {
    expect(fieldState(1000, 599).state).toBe("below_mark");
    expect(fieldState(1000, 600).state).toBe("at_mark");
  });
  it("below the minimum sample there is no accuracy", () => {
    expect(fieldState(9, 9)).toEqual({ pct: null, state: "too_few" });
  });
  it("Vienna: all ten SIP subjects, missing ones count as too few, so not ready", () => {
    const r = buildFieldReadiness("kenntnispruefung", [{ topic: "Neurologie", answered: 50, correct: 45 }]);
    expect(r.fields).toHaveLength(VIENNA_EXAM_PARTS.sip4.length + VIENNA_EXAM_PARTS.sip5.length);
    expect(r.allAtMark).toBe(false);
    expect(r.tooFew).toBe(r.fields.length - 1);
  });
  it("every field at 60 or more with the minimum answered is ready; one at 59.9 is not", () => {
    const all = [...VIENNA_EXAM_PARTS.sip4, ...VIENNA_EXAM_PARTS.sip5];
    const ok = buildFieldReadiness("kenntnispruefung", all.map((t) => ({ topic: t, answered: 20, correct: 12 })));
    expect(ok.allAtMark).toBe(true);
    const rows = all.map((t) => ({ topic: t, answered: 1000, correct: 600 }));
    rows[3] = { topic: all[3], answered: 1000, correct: 599 };
    const no = buildFieldReadiness("kenntnispruefung", rows);
    expect(no.allAtMark).toBe(false);
    expect(no.fields[0].field).toBe(all[3]);
  });
  it("other banks use the bank's topics", () => {
    const r = buildFieldReadiness("kmp_innsbruck", [{ topic: "HNO", answered: 12, correct: 5 }], ["HNO", "Intensivmedizin"]);
    expect(r.fields.map((f) => f.field)).toEqual(["HNO", "Intensivmedizin"]);
    expect(r.fields[0].part).toBeNull();
  });
});

function attempt(i: number, topicCounts: Record<string, [number, number]>, config: Record<string, unknown> | null = { part: "all", presetId: "kp_full" }): TrendAttemptInput {
  const ids: number[] = [];
  const grading: Record<string, { is_correct: boolean }> = {};
  let id = i * 1000;
  for (const [topic, [correct, total]] of Object.entries(topicCounts)) {
    for (let k = 0; k < total; k++) {
      id += 1;
      ids.push(id);
      grading[String(id)] = { is_correct: k < correct };
      topicOf.set(id, topic);
    }
  }
  return { id: `a${i}`, completedAt: `2026-0${i + 1}-01T10:00:00Z`, examType: "kenntnispruefung", config, questionIds: ids, grading };
}
const topicOf = new Map<number, string>();

describe("INF-04 mock exam trend", () => {
  it("three comparable full runs give a per-subject series, the gap to 60 and the delta", () => {
    const runs = [attempt(1, { A: [5, 10], B: [9, 10] }), attempt(2, { A: [6, 10], B: [8, 10] }), attempt(3, { A: [7, 10], B: [9, 10] })];
    const t = buildExamTrend(runs, topicOf);
    expect(t).toMatchObject({ fullRuns: 3, comparableRuns: 3, presetId: "kp_full" });
    const a = t.subjects.find((s) => s.topic === "A")!;
    expect(a.points.map((p) => p.pct)).toEqual([50, 60, 70]);
    expect(a.gapToMark).toBe(10);
    expect(a.delta).toBe(10);
    expect(t.subjects[0].topic).toBe("A"); // lowest latest score first
  });
  it("two runs give no trend", () => {
    const t = buildExamTrend([attempt(1, { A: [5, 10] }), attempt(2, { A: [6, 10] })], topicOf);
    expect(t.fullRuns).toBe(2);
    expect(t.subjects).toEqual([]);
  });
  it("a subject with 9 questions in a run gives no delta and no gap", () => {
    const runs = [attempt(1, { A: [5, 10] }), attempt(2, { A: [6, 10] }), attempt(3, { A: [7, 9] })];
    const a = buildExamTrend(runs, topicOf).subjects[0];
    expect(a.delta).toBeNull();
    expect(a.gapToMark).toBeNull();
  });
  it("custom, part and KAF runs never count as full runs; legacy full runs do", () => {
    expect(fullRunKey({ examType: "kenntnispruefung", config: { part: "custom" } })).toBeNull();
    expect(fullRunKey({ examType: "kenntnispruefung", config: { part: "sip4", presetId: "kp_sip4" } })).toBeNull();
    expect(fullRunKey({ examType: "kenntnispruefung", config: { kind: "kaf", part: "all" } })).toBeNull();
    expect(fullRunKey({ examType: "kenntnispruefung", config: { part: "all" } })).toBe("kp_full");
    expect(fullRunKey({ examType: "kenntnispruefung", config: null })).toBe("kp_full");
  });
  it("removed questions are left out, never counted wrong", () => {
    const runs = [attempt(1, { A: [10, 10] }), attempt(2, { A: [10, 10] }), attempt(3, { A: [10, 10] })];
    runs[2] = { ...runs[2], questionIds: [...runs[2].questionIds, 999_999] };
    expect(buildExamTrend(runs, topicOf).subjects[0].points[2]).toMatchObject({ total: 10, pct: 100 });
  });
});
