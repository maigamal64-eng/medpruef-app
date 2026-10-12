/**
 * a37 mentor trust package: Arabic stays a whole-English fallback until [name]
 * signs off (pick-arabic A, MUX-17), the legacy AI tab shares the mentor's name
 * table and trust line (MUX-90, TR-30), and the trust gate covers every slice.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MENTOR_DICTS, MENTOR_KEYS, MENTOR_NAMES, mentorT } from "@/lib/i18n-mentor";
import { MENTOR_ANSWER_LANGS, defaultAnswerLang } from "@/components/mentor/view-model";
import { renderedLanguage } from "@/lib/master-locale/render";
import { AI_CHAT_COPY } from "@/components/ai-chat-copy";

describe("MUX-17 Arabic interim (pick-arabic A)", () => {
  it("has no machine-written Arabic mentor strings and renders the English shell left to right", () => {
    expect(Object.keys(MENTOR_DICTS.ar)).toHaveLength(0);
    for (const key of MENTOR_KEYS) expect(mentorT(key, "ar")).toBe(mentorT(key, "en"));
    expect(MENTOR_NAMES.ar).toEqual(MENTOR_NAMES.en);
    expect(renderedLanguage("ar")).toEqual({ lang: "en", dir: "ltr" });
  });

  it("offers no Arabic answer language until sign-off and answers Arabic users in English", () => {
    expect(MENTOR_ANSWER_LANGS).not.toContain("ar");
    expect(defaultAnswerLang("ar")).toBe("en");
  });
});

describe("MUX-90 one AI name and trust standard", () => {
  it("the legacy tab uses the mentor's KI/AI badge and never the old assistant name", () => {
    expect(AI_CHAT_COPY.de.badge).toBe(MENTOR_NAMES.de.badge);
    expect(AI_CHAT_COPY.en.badge).toBe(MENTOR_NAMES.en.badge);
    const src = readFileSync("src/components/AIChatAssistant.tsx", "utf8");
    expect(src).not.toMatch(/MedPrüf Assistent|MedPrüf Assistant/);
  });

  it("shows the error line and report only under real AI answers, and labels bank text as not AI", () => {
    const src = readFileSync("src/components/AIChatAssistant.tsx", "utf8");
    expect(src).toMatch(/msg\.role === "assistant" && msg\.source === "ai" && \(\s*<p data-ai-trust/);
    expect(src).toContain('source: fromBank ? "bank" : "notice"');
    expect(AI_CHAT_COPY.de.trustLine).toBe("KI-generiert, kann Fehler enthalten.");
    expect(AI_CHAT_COPY.de.bankLabel).toContain("nicht von der KI");
  });

  it("legacy chat copy is in Sie and never anchors on option letters", () => {
    const de = Object.values(AI_CHAT_COPY.de).join("\n");
    expect(de).not.toMatch(/\b(?:du|dich|dir|dein\w*|Du|Dein\w*)\b/u);
    expect(`${de}\n${Object.values(AI_CHAT_COPY.en).join("\n")}`).not.toMatch(/\bOption [A-H]\b/);
  });

  it("flashcards label an AI-only explanation as AI", () => {
    const src = readFileSync("src/app/flashcards/page.tsx", "utf8");
    expect(src).toContain("const explanationIsAi = !bankExplanation && hasExplanation;");
    expect(src).toContain("aiCopy.trustLine");
  });
});

describe("OW-20 / MUX-115 / MUX-16 trust gate", () => {
  it("runs the deadline, precision, trust, explain-multilingual and multilingual slices", () => {
    const gate = readFileSync("scripts/mentor-trust-gate.mjs", "utf8");
    for (const slice of ["deadline_first", "precision", "trust", "explain_multilingual", "multilingual"]) expect(gate).toContain(`name:"${slice}"`);
    expect(gate).toContain("src/lib/mentor/prompt/system.ts");
  });
});
