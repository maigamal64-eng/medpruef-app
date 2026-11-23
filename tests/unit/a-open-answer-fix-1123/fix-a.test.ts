/**
 * a-open-answer-fix-1123, Fix A: a topic of another bank is never linked into
 * this exam; quiz_empty tells a filter empty from exhaustion; the builder only
 * offers exam years on banks whose rows carry exam_dates.
 */
import { describe, expect, it } from "vitest";
import { lapsedTopic, resolveNextStep, sameBank } from "@/lib/next-step";
import { quizEmptyReason } from "@/lib/quiz-empty";
import { bankHasExamDates, EXAM_SOURCE_IDS } from "@/lib/topics";

const NOW = new Date("2026-11-23T10:00:00Z");
const base = { audience: "pro" as const, now: NOW };

describe("next-step: last topic keeps its bank", () => {
  it("KP topic into pharma gives a link without topic=", () => {
    const step = resolveNextStep({ ...base, exam: "pharma", lastSession: { topic: "Neurologie", examType: "kenntnispruefung", lastActiveAt: "2026-11-22T10:00:00Z" } });
    expect(step.kind).not.toBe("last_topic");
    expect(step.href).not.toContain("topic=");
    expect(step.href).toContain("pharma");
  });
  it("same bank still links the topic", () => {
    const step = resolveNextStep({ ...base, exam: "kenntnispruefung", lastSession: { topic: "Neurologie", examType: "kenntnispruefung", lastActiveAt: "2026-11-22T10:00:00Z" } });
    expect(step.kind).toBe("last_topic");
    expect(step.href).toContain("topic=Neurologie");
  });
  it("an old caller without examType behaves as before", () => {
    const step = resolveNextStep({ ...base, exam: "kenntnispruefung", lastSession: { topic: "Neurologie", lastActiveAt: "2026-11-22T10:00:00Z" } });
    expect(step.kind).toBe("last_topic");
  });
  it("lapsed hero helper: other bank gives no topic", () => {
    expect(lapsedTopic({ topic: "Neurologie", examType: "kenntnispruefung" }, "pharma")).toBeNull();
    expect(lapsedTopic({ topic: "Neurologie", examType: "kenntnispruefung" }, "kenntnispruefung")).toBe("Neurologie");
    expect(lapsedTopic(null, "pharma")).toBeNull();
    expect(sameBank(undefined, "pharma")).toBe(true);
  });
});

describe("quiz_empty reason", () => {
  it("unseen with an exam year is filtered, not all_seen", () => {
    expect(quizEmptyReason("unseen", { examYear: "2025", tags: [], filter: "all" })).toBe("filtered");
  });
  it("tags or an incorrect/flagged filter are filtered", () => {
    expect(quizEmptyReason("unseen", { tags: ["x"] })).toBe("filtered");
    expect(quizEmptyReason("unseen", { filter: "incorrect" })).toBe("filtered");
    expect(quizEmptyReason("unseen", { filter: "flagged" })).toBe("filtered");
  });
  it("a plain or unused unseen empty stays all_seen (watchers read it)", () => {
    expect(quizEmptyReason("unseen", { examYear: "", tags: [], filter: "all" })).toBe("all_seen");
    expect(quizEmptyReason("unseen", { filter: "unused" })).toBe("all_seen");
    expect(quizEmptyReason("unseen", {})).toBe("all_seen");
  });
  it("other modes stay other", () => {
    expect(quizEmptyReason("wrong", { examYear: "2025" })).toBe("other");
  });
});

describe("builder bank capability", () => {
  it("pharma has no exam years; the two exam banks do", () => {
    expect(bankHasExamDates("pharma")).toBe(false);
    expect(bankHasExamDates("kenntnispruefung")).toBe(true);
    expect(bankHasExamDates("kmp_innsbruck")).toBe(true);
  });
  it("every bank is classified on purpose", () => {
    expect(EXAM_SOURCE_IDS.filter(bankHasExamDates).sort()).toEqual(["kenntnispruefung", "kmp_innsbruck"]);
  });
});
