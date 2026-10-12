import { describe, expect, it } from "vitest";
import { clampDurationMs, parseAccepted, parseKafAnswers, parseSelfMarks, sanitizeExamConfig, MAX_EXAM_DURATION_MS } from "@/lib/exam-history-server";

describe("POST /api/history/exams helpers (a24)", () => {
  it("clamps the stored working time to the run's own clock plus a minute", () => {
    const pharma = sanitizeExamConfig({ durationS: 3600 }, [1]);
    expect(clampDurationMs(2 * 3600_000, pharma)).toBe(3600_000 + 60_000);
    expect(clampDurationMs(-5, pharma)).toBe(0);
    expect(clampDurationMs("x", pharma)).toBeNull();
  });
  it("legacy rows without a clock keep the four-hour cap; untimed runs the eight-hour cap", () => {
    expect(clampDurationMs(9 * 3600_000, sanitizeExamConfig({}, [1]))).toBe(4 * 3600_000 + 60_000);
    expect(clampDurationMs(9 * 3600_000, sanitizeExamConfig({ untimed: true }, [1]))).toBe(MAX_EXAM_DURATION_MS);
  });
  it("whitelists config keys and keeps flagged ids that belong to the run", () => {
    const c = sanitizeExamConfig({ part: "sip4", presetId: "kp_sip4", passRuleId: "sip-overall-and-blocks-60", evil: "<script>", flagged_ids: [1, 2, 99], owed: ["Innere Medizin"], kind: "kaf" }, [1, 2, 3]);
    expect(c).toMatchObject({ part: "sip4", presetId: "kp_sip4", kind: "kaf", flagged_ids: [1, 2], owed: ["Innere Medizin"] });
    expect(c).not.toHaveProperty("evil");
    expect(sanitizeExamConfig({ part: "x y z" }, []).part).toBeNull();
  });
  it("KAF answers: at most three per item, only items in the run, self marks need an answer", () => {
    const answers = parseKafAnswers({ 1: ["a", "b", "c", "d"], 2: [" "], 7: ["x"] }, [1, 2]);
    expect(answers).toEqual({ 1: ["a", "b", "c"] });
    expect(parseSelfMarks({ 1: true, 2: true, 3: "yes" }, answers)).toEqual({ 1: true });
    expect(parseAccepted([["Lungenembolie", ""], [], "x"])).toEqual([["Lungenembolie"]]);
  });
});
