import { describe, expect, it } from "vitest";
import { missedQuestionIds, practiseIdsHref, reviewIndices, runCounts, weakestTopics } from "@/lib/exam-run";
import { parsePracticeMode } from "@/lib/practice-mode";

const q = (id: number, topic: string) => ({ id, topic, options: [{ text: "a", correct: true }, { text: "b", correct: false }] });
const qs = [q(1, "A"), q(2, "A"), q(3, "B"), q(4, "B")];
const answers = { 0: [0], 1: [1], 3: [0] };

describe("exam run helpers", () => {
  it("counts right, wrong, open and flagged", () => {
    expect(runCounts(qs, answers, new Set([2]))).toEqual({ total: 4, correct: 2, wrong: 1, open: 1, flagged: 1 });
  });
  it("review filters and the subject filter (UX-EXM-32)", () => {
    expect(reviewIndices("wrong", qs, answers, new Set())).toEqual([1]);
    expect(reviewIndices("open", qs, answers, new Set())).toEqual([2]);
    expect(reviewIndices("flagged", qs, answers, new Set([3]))).toEqual([3]);
    expect(reviewIndices("all", qs, answers, new Set(), "B")).toEqual([2, 3]);
  });
  it("practise the misses: wrong and open ids through the ids filter, never practiceMode=wrong", () => {
    expect(missedQuestionIds(qs, answers)).toEqual([2, 3]);
    const href = practiseIdsHref([2, 3, 3], "kenntnispruefung");
    expect(href).toContain("ids=2%2C3");
    expect(href).not.toContain("practiceMode");
  });
  it("weakest topics need ten answers", () => {
    expect(weakestTopics([{ topic: "A", answered: 5, accuracy: 10 }, { topic: "B", answered: 20, accuracy: 40 }, { topic: "C", answered: 30, accuracy: 70 }])).toEqual(["B", "C"]);
  });
  it("practiceMode=exam is accepted; unknown modes read as all (UX-EXM-23)", () => {
    expect(parsePracticeMode("exam")).toBe("exam");
    expect(parsePracticeMode("drop table")).toBe("all");
    expect(parsePracticeMode(null)).toBe("all");
  });
});
