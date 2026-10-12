import { describe, expect, it } from "vitest";
import { evaluatePassRule, runVerdict, type SubjectResult } from "@/lib/exam-grading";
import { subjectResults } from "@/lib/exam-run";

const subj = (topic: string, correct: number, total: number): SubjectResult => ({ topic, total, answered: total, correct, pct: correct / total, avgSecondsPerQuestion: null });

describe("SIP block rule (sip.pass, CNT-13 / SIM-02)", () => {
  it("overall fail: below 60 percent overall repeats the whole exam", () => {
    const r = evaluatePassRule("sip-overall-and-blocks-60", [subj("Innere Medizin", 10, 28), subj("Chirurgische Fächer", 15, 28), subj("Dermatologie und Venerologie", 8, 14)]);
    expect(r.passed).toBe(false);
    expect(r.overallPct).toBeLessThan(0.6);
    const v = runVerdict("sip-overall-and-blocks-60", [subj("Innere Medizin", 10, 28), subj("Chirurgische Fächer", 15, 28), subj("Dermatologie und Venerologie", 8, 14)]);
    expect(v.kind).toBe("blocks");
    expect(v.ruleStatus).toBe("official");
  });

  it("overall pass with one block below 60 percent: only that block is to repeat", () => {
    const r = evaluatePassRule("sip-overall-and-blocks-60", [subj("Innere Medizin", 26, 28), subj("Chirurgische Fächer", 24, 28), subj("Dermatologie und Venerologie", 7, 14)]);
    expect(r.overallPct).toBeGreaterThanOrEqual(0.6);
    expect(r.passed).toBe(false);
    expect(r.negativeUnits).toEqual(["Dermatologie und Venerologie"]);
  });

  it("all pass: overall and every block at 60 percent or more", () => {
    const r = evaluatePassRule("sip-overall-and-blocks-60", [subj("Innere Medizin", 17, 28), subj("Chirurgische Fächer", 17, 28), subj("Dermatologie und Venerologie", 9, 14)]);
    expect(r.passed).toBe(true);
    expect(r.negativeUnits).toEqual([]);
  });
});

describe("run verdicts", () => {
  it("practice runs (custom, pharma, Innsbruck legacy) have no rule and no chip", () => {
    expect(runVerdict(null, [subj("x", 5, 10)]).kind).toBe("practice");
    expect(runVerdict(undefined, []).evaluation).toBeNull();
  });
  it("the full Vienna run uses the practice threshold, not an official rule", () => {
    const v = runVerdict("overall-60", [subj("x", 6, 10)]);
    expect(v.kind).toBe("threshold");
    expect(v.ruleStatus).toBeNull();
  });
  it("Stichprobentest six-of-ten fields rule reads its official source", () => {
    const v = runVerdict("stp-six-fields-60", Array.from({ length: 10 }, (_, i) => subj(`f${i}`, i < 6 ? 18 : 5, 25)));
    expect(v.kind).toBe("fields");
    expect(v.evaluation?.passed).toBe(true);
    expect(v.ruleStatus).toBe("official");
  });
  it("partial multi-select is wrong and unanswered is open (all or nothing)", () => {
    const q = { id: 1, topic: "T", options: [{ text: "a", correct: true }, { text: "b", correct: true }, { text: "c", correct: false }] };
    const s = subjectResults([q, q, q], { 0: [0], 1: [0, 1] });
    expect(s[0]).toMatchObject({ total: 3, answered: 2, correct: 1 });
  });
});
