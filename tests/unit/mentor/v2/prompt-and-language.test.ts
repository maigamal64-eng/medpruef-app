/**
 * a-mentor-better-1106: the v2 prompt is today's prompt plus anchored edits; flag off is byte for
 * byte today's brain; and the language choice for v2 turns (the picker, Arabic in Arabic, the deeper
 * chip in the answer language) follows the a-ai-fix-1106 rule.
 */
import { describe, expect, it } from "vitest";
import { MENTOR_CORE_PROMPT, buildSystemBlocks } from "@/lib/mentor/prompt/system";
import { MENTOR_TOOLS } from "@/lib/mentor/tools/definitions";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { MENTOR_V2_PROMPT_EDITS, applyV2Edits, buildSystemBlocksV2, mentorCorePromptV2 } from "@/lib/mentor/v2/prompt";
import { FIND_QUESTIONS_TOOL } from "@/lib/mentor/v2/find-questions";
import { v2Copy } from "@/lib/mentor/v2/copy";
import { effectiveAnswerLang } from "@/lib/mentor/answer-language";
import { parseChatRequest } from "@/lib/mentor/guard";
import { readMentorConfig } from "@/lib/mentor/config";
import type { FactsLoader, MentorFact, TurnContext } from "@/lib/mentor/seam";

const NOW = new Date("2026-11-06T10:00:00Z");
const sheet: MentorFact[] = [];
const facts = {
  sheetFacts: () => sheet,
  peek: () => null,
  byIds: async () => [],
  search: async () => [],
  dates: async () => ({ sittings: [], facts: [] }),
} as unknown as FactsLoader & { sheetFacts: () => MentorFact[]; peek: () => null };

function ctx(over: Partial<TurnContext> = {}): TurnContext {
  return { userId: "u1", requestId: "r1", lang: "de", mode: "facts", now: NOW, paidAccess: true, ...over };
}

describe("v2 prompt edits", () => {
  it("every anchor is in today's prompt exactly once", () => {
    for (const e of MENTOR_V2_PROMPT_EDITS) {
      const anchor = e.kind === "line" ? e.start : e.from;
      expect(MENTOR_CORE_PROMPT.split(anchor).length - 1, anchor.slice(0, 50)).toBe(1);
    }
  });

  it("replaces the UC13 refusal with the grounded route and keeps every other rule", () => {
    const v2 = mentorCorePromptV2();
    expect(v2).not.toContain("do not explain it, from any source");
    expect(v2).toContain("call find_questions first");
    expect(v2).toContain("a third-person exam case or a textbook question is never patient advice");
    expect(v2).toContain("at most about 80 words (depth deep: about 150)");
    // The rules the trust gate proved are still there word for word.
    for (const kept of ["DEADLINES\n", "GROUNDING (checked by code after you answer)", "Never use web knowledge, guidelines or textbooks as a citation.", "REFUSE (one short line, then stop) when asked for:", "patient_advice: advice about a real patient or the learner's own health"]) {
      expect(v2).toContain(kept);
    }
  });

  it("a missing anchor throws instead of shipping a half-edited prompt", () => {
    expect(() => applyV2Edits("an unrelated prompt")).toThrow(/anchor missing/);
  });

  it("has no em dash and no exclamation mark in what it adds", () => {
    const added = MENTOR_V2_PROMPT_EDITS.map((e) => e.to).join("\n");
    expect(added).not.toMatch(/—/);
    expect(added).not.toContain("!");
  });
});

describe("flag off is today's brain, byte for byte", () => {
  it("tools and system blocks are identical to the v1 builders", () => {
    const brain = createMentorBrain({ facts, clock: () => NOW });
    expect(JSON.stringify(brain.tools)).toBe(JSON.stringify(MENTOR_TOOLS));
    expect(JSON.stringify(brain.buildSystem(ctx()))).toBe(JSON.stringify(buildSystemBlocks(ctx(), sheet)));
  });

  it("MENTOR_V2_ENABLED is off unless the literal true", () => {
    expect(readMentorConfig({}).v2Enabled).toBe(false);
    expect(readMentorConfig({ MENTOR_V2_ENABLED: "1" }).v2Enabled).toBe(false);
    expect(readMentorConfig({ MENTOR_V2_ENABLED: "true" }).v2Enabled).toBe(true);
  });
});

describe("flag on: v2 brain", () => {
  const brain = createMentorBrain({ facts, clock: () => NOW, v2: true });

  it("appends find_questions after the frozen four (the v1 tool bytes stay first)", () => {
    expect(brain.tools.map((t) => t.name)).toEqual([...MENTOR_TOOLS.map((t) => t.name), "find_questions"]);
    expect(JSON.stringify(brain.tools.slice(0, 4))).toBe(JSON.stringify(MENTOR_TOOLS));
    expect(brain.tools[4]).toBe(FIND_QUESTIONS_TOOL);
  });

  it("keeps the fact sheet block (the cache breakpoint) identical and puts the learner context after it", () => {
    const c = ctx({ v2: { learner: { activeExam: "pharma", sittingBand: "exam_week", weakTopics: ["Antibiotika"], recentWrongTopics: [], answeredBand: "some" }, moment: "exam_week", depth: "short" } });
    const v1 = buildSystemBlocks(c, sheet);
    const v2 = brain.buildSystem(c);
    expect(v2).toHaveLength(3);
    expect(JSON.stringify(v2[1])).toBe(JSON.stringify(v1[1]));
    expect(v2[1].cache_control).toEqual({ type: "ephemeral" });
    expect(v2[0].text).toBe(mentorCorePromptV2());
    expect(v2[2].text.startsWith(v1[2].text)).toBe(true);
    expect(v2[2].text).toContain("LEARNER CONTEXT");
    expect(v2[2].text).toContain("moment=exam_week");
    // Blocks 0 and 1 hold nothing per learner: two learners share the cached prefix.
    const other = brain.buildSystem(ctx({ userId: "u2", lang: "ar", v2: { learner: null, moment: "open", depth: "deep" } }));
    expect(other[0].text).toBe(v2[0].text);
    expect(other[1].text).toBe(v2[1].text);
  });

  it("a v2 turn without a v2 context still builds (moment open, depth short)", () => {
    expect(buildSystemBlocksV2(ctx(), sheet)[2].text).toContain("moment=open; depth=short");
  });
});

describe("language choice (v2 turns)", () => {
  it("Arabic script is answered in Arabic whatever the picker says; Latin text keeps the picker", () => {
    expect(effectiveAnswerLang("إيه هي أدوية SSRI؟", "de")).toBe("ar");
    expect(effectiveAnswerLang("Was sind SSRI?", "en")).toBe("en");
    expect(effectiveAnswerLang("What are SSRIs?", "de")).toBe("de");
  });

  it("the deeper chip sends its message in the answer language, so the language never flips", () => {
    for (const lang of ["de", "en", "ar", "ru", "uk", "tr", "fr"] as const) {
      const message = v2Copy("deeper_message", lang);
      expect(effectiveAnswerLang(message, lang), lang).toBe(lang);
    }
    expect(v2Copy("deeper_message", "de")).toBe("Bitte erklären Sie das ausführlicher.");
    expect(v2Copy("deeper_message", "ar")).toMatch(/[؀-ۿ]/);
    expect(v2Copy("deeper_chip", "ru")).toBe(v2Copy("deeper_chip", "en"));
  });

  it("v2 copy: German uses Sie, no em dash, no exclamation mark, no digit", () => {
    for (const lang of ["de", "en", "ar"] as const) {
      for (const key of ["deeper_chip", "deeper_message", "start_simulation", "from_bank"] as const) {
        const t = v2Copy(key, lang);
        expect(t).not.toMatch(/—|!|\p{Nd}/u);
      }
    }
    expect(v2Copy("deeper_message", "de")).not.toMatch(/\b(du|dir|dich|dein)\b/i);
  });

  it("the turn context of a v2 Arabic turn carries the Arabic answer rule and Arabic glosses", () => {
    const brain = createMentorBrain({ facts, clock: () => NOW, v2: true });
    const text = brain.buildSystem(ctx({ lang: "ar", mode: "explain", questionId: 5, answered: true, v2: { learner: null, moment: "after_wrong", depth: "short" } }))[2].text;
    expect(text).toContain("Answer in Arabic (lang=ar)");
    expect(text).toContain("Glosses in brackets are Arabic in Arabic script only");
    expect(text).toContain("moment=after_wrong");
  });

  it("the request parser accepts depth deep only", () => {
    const base = { client_request_id: "6f1b5c1e-6f0a-4f43-9c39-0d5a1a7f2a11", message: "Bitte ausführlicher.", lang: "de", mode: "facts" };
    const ok = parseChatRequest({ ...base, depth: "deep" });
    expect(ok.ok && ok.request.depth).toBe("deep");
    expect(parseChatRequest({ ...base, depth: "short" }).ok).toBe(false);
    const none = parseChatRequest(base);
    expect(none.ok && none.request.depth).toBeUndefined();
  });
});
