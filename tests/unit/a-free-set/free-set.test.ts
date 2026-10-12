import { describe, expect, it } from "vitest";
import data from "@/lib/free-set.data.json";
import {
  FREE_SET_SIZE,
  classifyFreeEmpty,
  computeFreeAccess,
  freeLeftByTopic,
  freeOpeningIds,
  freeSetIds,
  freeSetTopicsAtBuild,
  freeUniverseIds,
  legacyFreeIds,
} from "@/lib/free-set";
import { sanitizeEventData, isAllowedEvent } from "@/lib/analytics-events";
import { firstRoundSize, planPromptEligible } from "@/lib/first-round-plan";
import { FREE_SET_COPY, freeEmptyText, freeLeftLine } from "@/lib/i18n-free-set";
import { FREE_TIER } from "@/lib/content-truth";
import { FREE_TIER_QUESTIONS_PER_EXAM } from "@/lib/free-tier";

const EXAMS = ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const;

describe("committed free set (a-free-set issue 1)", () => {
  it("keeps the size: 150 unique ids per exam, cap number unchanged", () => {
    expect(FREE_SET_SIZE).toBe(150);
    expect(FREE_TIER_QUESTIONS_PER_EXAM).toBe(150);
    expect(FREE_TIER.questions_per_exam_type).toBe(150);
    for (const exam of EXAMS) {
      expect(new Set(freeSetIds(exam)).size).toBe(150);
      expect(new Set(legacyFreeIds(exam)).size).toBe(150);
    }
  });

  it("spreads across topics as evenly as the topics allow", () => {
    for (const exam of ["kenntnispruefung", "kmp_innsbruck"] as const) {
      const topics = (data.topics as Record<string, Record<string, number[]>>)[exam];
      const sizes = Object.values(topics).map((ids) => ids.length);
      expect(Object.keys(topics).length).toBeGreaterThanOrEqual(10);
      const share = Math.floor(150 / sizes.length);
      // Only a topic with fewer good rows than its share may fall below it.
      expect(Math.max(...sizes) - share).toBeLessThanOrEqual(1);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(150);
      const flat = Object.values(topics).flat().sort((a, b) => a - b);
      expect(flat).toEqual([...freeSetIds(exam)].sort((a, b) => a - b));
    }
    // The old problem: one topic held 118 of 150 Kenntnisprüfung questions.
    const kp = (data.topics as Record<string, Record<string, number[]>>).kenntnispruefung;
    expect(Math.max(...Object.values(kp).map((ids) => ids.length))).toBeLessThanOrEqual(15);
  });

  it("the opening is five ids inside the set, one topic each where the bank has several", () => {
    for (const exam of EXAMS) {
      const opening = freeOpeningIds(exam);
      expect(opening).toHaveLength(5);
      for (const id of opening) expect(freeSetIds(exam)).toContain(id);
    }
    for (const exam of ["kenntnispruefung", "kmp_innsbruck"] as const) {
      const topicOf = freeSetTopicsAtBuild(exam);
      expect(new Set(freeOpeningIds(exam).map((id) => topicOf.get(id))).size).toBe(5);
    }
  });

  it("unknown exams have no free questions", () => {
    expect(freeSetIds("nope")).toEqual([]);
    expect(freeUniverseIds("__proto__")).toEqual([]);
  });
});

describe("computeFreeAccess (issue 2: nobody loses free questions)", () => {
  const exam = "kmp_innsbruck";
  const NEW = [...freeSetIds(exam)];
  const LEGACY_ONLY = legacyFreeIds(exam).filter((id) => !NEW.includes(id));
  const NEW_ONLY = NEW.filter((id) => !legacyFreeIds(exam).includes(id));

  it("new learner: the new set, nothing else", () => {
    const a = computeFreeAccess({ exam, answered: [], signedIn: true, enforced: true });
    expect(a.capped).toBe(false);
    expect(a.counted).toBe(0);
    expect(a.readable).toEqual([...NEW].sort((x, y) => x - y));
  });

  it("answered old-slice questions stay readable and count; other answers do not count", () => {
    const a = computeFreeAccess({ exam, answered: [LEGACY_ONLY[0], 123456789], signedIn: true, enforced: true });
    expect(a.readable).toContain(LEGACY_ONLY[0]);
    expect(a.readable).not.toContain(LEGACY_ONLY[1]);
    expect(a.readable).not.toContain(123456789);
    expect(a.counted).toBe(1);
  });

  it("caps at exactly 150 distinct free answers, then only answered free questions are readable", () => {
    const answered149 = [...LEGACY_ONLY.slice(0, 120), ...NEW_ONLY.slice(0, 29)];
    expect(computeFreeAccess({ exam, answered: answered149, signedIn: true, enforced: true }).capped).toBe(false);
    const answered150 = [...answered149, NEW_ONLY[29]];
    const a = computeFreeAccess({ exam, answered: answered150, signedIn: true, enforced: true });
    expect(a.capped).toBe(true);
    expect(new Set(a.readable)).toEqual(new Set(answered150));
  });

  it("answers outside the sets count toward the cap through examAnswered (2 Oct rule)", () => {
    expect(computeFreeAccess({ exam, answered: [], examAnswered: 149, signedIn: true, enforced: true }).capped).toBe(false);
    const a = computeFreeAccess({ exam, answered: [NEW_ONLY[0]], examAnswered: 150, signedIn: true, enforced: true });
    expect(a.capped).toBe(true);
    expect(a.counted).toBe(150);
    expect(a.readable).toEqual([NEW_ONLY[0]]);
    expect(computeFreeAccess({ exam, answered: [], examAnswered: 500, signedIn: false, enforced: true }).capped).toBe(false);
  });

  it("guests and enforcement off", () => {
    expect(computeFreeAccess({ exam, answered: [LEGACY_ONLY[0]], signedIn: false, enforced: true }).readable).not.toContain(LEGACY_ONLY[0]);
    const all = [...LEGACY_ONLY, ...NEW_ONLY];
    expect(computeFreeAccess({ exam, answered: all, signedIn: true, enforced: false }).capped).toBe(false);
  });
});

describe("classifyFreeEmpty (issue 3: honest empty state)", () => {
  const topicOf = new Map<number, string>([[1, "A"], [2, "A"], [3, "B"], [4, "C"], [5, "C"], [6, "C"], [7, "D"]]);
  it("names no_free_in_topic, all_seen and other, with up to 3 topics that have free questions left", () => {
    const none = classifyFreeEmpty({ topicOf, answered: new Set(), requestedTopics: ["Z"] });
    expect(none).toMatchObject({ exhausted: false, reason: "no_free_in_topic" });
    expect(none.topics).toEqual([{ topic: "C", left: 3 }, { topic: "A", left: 2 }, { topic: "B", left: 1 }]);
    const seen = classifyFreeEmpty({ topicOf, answered: new Set([1, 2]), requestedTopics: ["A"] });
    expect(seen.reason).toBe("all_seen");
    expect(seen.topics.map((t) => t.topic)).not.toContain("A");
    expect(classifyFreeEmpty({ topicOf, answered: new Set(), requestedTopics: null }).reason).toBe("other");
  });
  it("exhausted only when every active free question is answered", () => {
    expect(classifyFreeEmpty({ topicOf, answered: new Set([1, 2, 3, 4, 5, 6]), requestedTopics: ["A"] }).exhausted).toBe(false);
    expect(classifyFreeEmpty({ topicOf, answered: new Set([1, 2, 3, 4, 5, 6, 7]), requestedTopics: ["A"] }).exhausted).toBe(true);
    expect(freeLeftByTopic(topicOf, new Set([4])).get("C")).toBe(2);
  });
});

describe("analytics (issues 2 and 3)", () => {
  it("quiz_start keeps a short topic list again; arrays stay bounded and only for allowed keys", () => {
    const out = sanitizeEventData("quiz_start", { topics: ["Innere Medizin", "Psychiatrie"], practiceMode: "unseen" });
    expect(out.topics).toEqual(["Innere Medizin", "Psychiatrie"]);
    const long = sanitizeEventData("quiz_start", { topics: Array.from({ length: 30 }, (_, i) => `T${i}`) });
    expect((long.topics as string[]).length).toBe(12);
    expect(sanitizeEventData("quiz_start", { tags: ["a"], topics: ["anna@example.com"] })).toEqual({});
    expect(sanitizeEventData("quiz_start", { topics: [{ x: 1 }, 5] })).toEqual({});
  });
  it("the three new events are allowed with their declared keys only", () => {
    for (const name of ["quiz_load_failed", "quiz_empty", "question_shown"]) expect(isAllowedEvent(name)).toBe(true);
    expect(sanitizeEventData("quiz_empty", { reason: "no_free_in_topic", mode: "unseen", exam: "kmp_innsbruck", topics: ["Neurologie"], userId: "x" }))
      .toEqual({ reason: "no_free_in_topic", mode: "unseen", exam: "kmp_innsbruck", topics: ["Neurologie"] });
    expect(sanitizeEventData("quiz_load_failed", { status: 503, reason: "retryable", mode: "all", topics: [] })).toEqual({ status: 503, reason: "retryable", mode: "all" });
    expect(sanitizeEventData("question_shown", { ms: 1830, mode: "unseen", exam: "kenntnispruefung", question_id: 5 })).toEqual({ ms: 1830, mode: "unseen", exam: "kenntnispruefung" });
  });
});

describe("first-round plan prompt (issue 13)", () => {
  it("only free accounts with no onboarding record, once", () => {
    const base = { free: true, server: { completed_at: null, skipped_at: null }, localOnboarding: null, alreadyPrompted: false };
    expect(planPromptEligible(base)).toBe(true);
    expect(planPromptEligible({ ...base, free: false })).toBe(false);
    expect(planPromptEligible({ ...base, alreadyPrompted: true })).toBe(false);
    expect(planPromptEligible({ ...base, localOnboarding: "{}" })).toBe(false);
    expect(planPromptEligible({ ...base, server: { completed_at: "2026-10-01", skipped_at: null } })).toBe(false);
    expect(planPromptEligible({ ...base, server: { completed_at: null, skipped_at: "2026-10-01" } })).toBe(false);
    expect(planPromptEligible({ ...base, server: null })).toBe(false);
    expect(firstRoundSize(20, true)).toBe(10);
    expect(firstRoundSize(5, false)).toBe(5);
  });
});

describe("free-set copy", () => {
  it("formal Sie, no em dashes, singular and plural", () => {
    const de = Object.values(FREE_SET_COPY.de).join(" ");
    const en = Object.values(FREE_SET_COPY.en).join(" ");
    expect(de + en).not.toMatch(/—/);
    expect(de).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
    expect(freeLeftLine(FREE_SET_COPY.de, 1)).toBe("1 kostenlose Frage übrig");
    expect(freeLeftLine(FREE_SET_COPY.de, 7)).toBe("7 kostenlose Fragen übrig");
    expect(freeEmptyText(FREE_SET_COPY.de, "no_free_in_topic", "Psychiatrie").title).toBe("Psychiatrie ist Teil von Pro.");
    expect(freeEmptyText(FREE_SET_COPY.en, "other", null).title).toBe("This selection is part of Pro.");
  });
});
