/**
 * Live trust gate, round 2 (a-mentor-gate2, 12 Oct 2026). The model should not
 * write unsourced values in the first place: no follow-up offer blocks, a
 * background layer that is usually omitted, study numbers only from the
 * progress tool, the gloss shape driven by the terms the learner named, a
 * doubtful key flagged instead of defended (TR-33), and glosses in the answer
 * language only.
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { buildTurnContext as systemTurnContext, MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { buildTurnContext } from "@/lib/mentor/turn";
import { learnerNamedTerms, rowTermsNamed } from "@/lib/mentor/gloss-terms";
import { progressNumbers } from "@/lib/mentor/tools/run";
import { stripForeignScriptGlosses } from "@/lib/mentor/validator";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import type { MentorTurnInput } from "@/lib/mentor/seam";
import { ctx, fakeDb, makeLoader } from "./helpers";

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

const vitK = {
  id: 9000008,
  exam_type: "pharma",
  topic: "Antidote",
  question: "Welches Antidot ist bei einer Blutung unter Phenprocoumon (Marcumar) angezeigt?",
  answer: "Vitamin K (Phytomenadion)",
  explanation: "Phenprocoumon ist ein Vitamin-K-Antagonist.",
  choices: [
    { text: "Protamin", correct: false },
    { text: "Vitamin K (Phytomenadion)", correct: true },
    { text: "Idarucizumab", correct: false },
  ],
};
const b12 = {
  id: 9000005,
  exam_type: "kenntnispruefung",
  topic: "Hämatologie",
  question: "Welche Anämie entsteht typischerweise bei Vitamin-B12-Mangel?",
  answer: "Megaloblastäre Anämie",
  explanation: "B12 ist für die DNA-Synthese nötig.",
  choices: [
    { text: "Megaloblastäre Anämie", correct: true },
    { text: "Mikrozytäre hypochrome Anämie", correct: false },
  ],
};

function input(message: string, lang: MentorTurnInput["request"]["lang"], mode: MentorTurnInput["request"]["mode"] = "explain"): MentorTurnInput {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    request: { message, lang, mode, question_id: 9000008 },
    history: [],
    paidAccess: true,
  } as unknown as MentorTurnInput;
}

describe("terms the learner named (r3-explain-gloss-*)", () => {
  it("keeps Latin-script terms of a Cyrillic or Turkish request, also the last word", () => {
    expect(learnerNamedTerms("Объясни эту тренировочную задачу. Сохрани немецкий термин и поясни его по-русски в скобках. Phytomenadion")).toEqual(["Phytomenadion"]);
    const tr = learnerNamedTerms("Bu alıştırma sorusunu açıkla. Almanca terimi koru ve Türkçe açıklamasını parantez içinde yaz. Protamin");
    expect(tr).toContain("Protamin");
    expect(learnerNamedTerms("Поясни це запитання. D.S.")).toEqual(["D.S."]);
    expect(learnerNamedTerms("Поясни. megaloblastär")).toEqual(["megaloblastär"]);
  });

  it("returns only terms the row contains, in the learner's spelling", () => {
    const corpus = [b12.question, ...b12.choices.map((c) => c.text), b12.answer, b12.explanation].join("\n");
    expect(rowTermsNamed(["megaloblastär"], corpus)).toEqual(["megaloblastär"]);
    const tr = learnerNamedTerms("Bu alıştırma sorusunu açıkla. Almanca terimi koru ve Türkçe açıklamasını parantez içinde yaz. megaloblastär");
    expect(rowTermsNamed(tr, corpus)).toEqual(["megaloblastär"]);
    // Short words match whole words only; request words never match a German row.
    expect(rowTermsNamed(["Explain", "practice", "question", "brackets", "Anäm"], corpus)).toEqual([]);
    expect(rowTermsNamed(["D.S."], "D.S. 3 x tgl.")).toEqual(["D.S."]);
    expect(rowTermsNamed(["D.S."], "D.Sx")).toEqual([]);
  });

  it("en/fr request words that look German never become gloss terms (review P2)", () => {
    const corpus = "Ein Patient mit Normalwerten. Welche Option ist richtig? Normal ist anders.";
    expect(rowTermsNamed(learnerNamedTerms("Why is the answer for this patient wrong? Explain the normal value."), corpus)).toEqual([]);
    expect(rowTermsNamed(learnerNamedTerms("Pourquoi cette option? Le patient est normal."), corpus)).toEqual([]);
  });

  it("keeps a letter-code suffix and short abbreviations, last named terms first", () => {
    expect(learnerNamedTerms("Объясни. Vitamin K")).toEqual(["Vitamin K"]);
    expect(learnerNamedTerms("Поясни Vitamin B12 и Rp.")).toEqual(["Vitamin B12", "Rp."]);
    expect(learnerNamedTerms("Explain the dose in mg.")).not.toContain("mg.");
    const corpus = [...vitK.choices.map((c) => c.text), vitK.question, "Rp. Furosemid"].join("\n");
    expect(rowTermsNamed(["Vitamin K"], corpus)).toEqual(["Vitamin K"]);
    expect(rowTermsNamed(["Vitamin K"], "Vitamin Kardiologie")).toEqual([]);
    expect(rowTermsNamed(["Rp."], corpus)).toEqual(["Rp."]);
    expect(rowTermsNamed(["Protamin", "Idarucizumab", "Marcumar", "Phenprocoumon", "Phytomenadion"], corpus)).toEqual(["Marcumar", "Phenprocoumon", "Phytomenadion"]);
  });

  it("stays fast on long hostile input", () => {
    const msg = `${"a.".repeat(500)} ${"Ä".repeat(1500)}`;
    const t0 = Date.now();
    const terms = learnerNamedTerms(msg);
    rowTermsNamed(Array.from({ length: 200 }, (_, i) => `Wort${"x".repeat(i % 30)}`), "y ".repeat(10_000));
    expect(Date.now() - t0).toBeLessThan(500);
    expect(terms.every((t) => t.length <= 40)).toBe(true);
  });

  it("the turn records named terms only for a non-German explain request", () => {
    expect(buildTurnContext(input("Поясни. Phytomenadion", "uk"), new Date()).namedTerms).toEqual(["Phytomenadion"]);
    expect(buildTurnContext(input("Erklären Sie Phytomenadion", "de"), new Date()).namedTerms).toBeUndefined();
    expect(buildTurnContext(input("When is Phytomenadion?", "en", "facts"), new Date()).namedTerms).toBeUndefined();
  });

  it("get_question hands back gloss_first and the gloss shape; never in hint mode or German", async () => {
    const { db } = fakeDb({ questions: { data: vitK } });
    const brain = createMentorBrain({ facts: makeLoader(), db: () => db });
    const r = await brain.runTool("get_question", { id: 9000008 }, ctx({ mode: "explain", lang: "ru", namedTerms: ["Phytomenadion", "Unbekannt"] }));
    const body = parse(r.content);
    expect(body.gloss_first).toEqual(["Phytomenadion"]);
    expect(String(body.instruction)).toContain("Never reuse an option's own brackets");
    expect(body.opening_template).toBe("Phytomenadion (…)");
    expect(String(body.instruction)).toContain("begins with opening_template copied character for character");
    expect(String(body.instruction)).toContain('write "the other options"');
    expect(String(body.instruction)).toContain("a point this row's explanation states goes in a grounded block");
    const hint = parse((await brain.runTool("get_question", { id: 9000008 }, ctx({ mode: "explain", lang: "ru", answered: false, namedTerms: ["Phytomenadion"] }))).content);
    expect(hint.gloss_first).toBeUndefined();
    expect(hint.opening_template).toBeUndefined();
    const de = parse((await brain.runTool("get_question", { id: 9000008 }, ctx({ mode: "explain", lang: "de", namedTerms: ["Phytomenadion"] }))).content);
    expect(de.gloss_first).toBeUndefined();
    expect(String(de.instruction)).not.toContain("Gloss shape");
  });

  it("the system prompt names the gloss_first contract and single-language examples", () => {
    expect(MENTOR_CORE_PROMPT).toContain("If get_question returns gloss_first and opening_template");
    expect(MENTOR_CORE_PROMPT).toContain("never transliterated");
    // Gate round 4: the examples moved to the turn context, one language per answer.
    expect(MENTOR_CORE_PROMPT).not.toContain('"Hyperkaliämie (hiperkalemi)"');
    expect(systemTurnContext(ctx({ lang: "tr", mode: "explain" }))).toContain('"Hyperkaliämie (hiperkalemi)"');
    expect(MENTOR_CORE_PROMPT).not.toContain("гиперкалиемия, high potassium");
    expect(MENTOR_CORE_PROMPT).toContain("never Cyrillic in a Turkish, French or English answer");
  });
});

describe("doubtful key is flagged, not defended (TR-33)", () => {
  it("prompt and tool contract ask for a report suggestion and forbid invented stem findings", async () => {
    expect(MENTOR_CORE_PROMPT).toContain("Doubtful key: if the keyed answer does not fit the stem");
    expect(MENTOR_CORE_PROMPT).toContain("never invent a stem finding to make it fit");
    expect(MENTOR_CORE_PROMPT).toContain("When the key fits, do not mention reporting and do not comment on whether the key fits.");
    const { db } = fakeDb({ questions: { data: b12 } });
    const r = await createMentorBrain({ facts: makeLoader(), db: () => db }).runTool("get_question", { id: 9000005 }, ctx({ mode: "explain", lang: "en" }));
    expect(String(parse(r.content).instruction)).toContain("say the key looks doubtful");
  });
});

describe("no unsourced values in the first place (precision false replacements)", () => {
  it("the output format has no follow-up offer block and forbids values in uncited blocks", () => {
    expect(MENTOR_CORE_PROMPT).not.toContain("An optional specific follow-up offer");
    expect(MENTOR_CORE_PROMPT).toContain("a @@BLOCK without facts= may hold only a refusal line");
    expect(MENTOR_CORE_PROMPT).toContain("Write no follow-up offer");
    expect(MENTOR_CORE_PROMPT).toContain("Do not add consequences, exceptions or implications of a rule");
    expect(MENTOR_CORE_PROMPT).toContain("Never count options, reasons, signs or topics yourself");
    expect(MENTOR_CORE_PROMPT).toContain("a point the row's own explanation states goes in a grounded block, never in background");
  });

  it("background is optional and its counting words are spelled out", () => {
    expect(MENTOR_CORE_PROMPT).toContain("Background is optional and usually left out");
    expect(MENTOR_CORE_PROMPT).toContain('no counting words (not "one ... the other", "two points", "a single", "both")');
  });

  it("get_dates forbids offers of other sittings", async () => {
    const now = new Date("2026-10-12T08:00:00Z");
    const brain = createMentorBrain({ facts: getMentorFactsLoader(), db: () => fakeDb({}).db, clock: () => now });
    const body = parse((await brain.runTool("get_dates", { exam_key: "sip5a", filing_university: "all" }, ctx({ now }))).content);
    expect((body.sittings as unknown[]).length).toBeGreaterThan(0);
    expect(String(body.answer_instruction)).toContain("Write no offer to show other sittings");
  });

  it("get_my_progress lists the numbers it states and forbids every other number", async () => {
    const { db } = fakeDb({
      users: { data: { active_exam: "kmp_innsbruck", exam_date: "2099-02-09" } },
      user_topic_strength: {
        data: [
          { exam_type: "kmp_innsbruck", topic: "Gynäkologie", answered: 14, correct: 5 },
          { exam_type: "kmp_innsbruck", topic: "Pädiatrie", answered: 28, correct: 22 },
        ],
      },
    });
    const r = await createMentorBrain({ facts: makeLoader(), db: () => db }).runTool("get_my_progress", {}, ctx({ mode: "study" }));
    const body = parse(r.content) as { progress: string; numbers_you_may_write: number[]; instruction: string };
    expect(body.numbers_you_may_write).toEqual(expect.arrayContaining([42, 27, 64, 14, 36]));
    // Every listed number is one the progress text states (so the validator accepts it).
    for (const n of body.numbers_you_may_write) expect(body.progress).toMatch(new RegExp(`(?<!\\d)${n}(?!\\d)`));
    expect(body.numbers_you_may_write).not.toContain(2099);
    expect(body.instruction).toContain("no threshold, sum, average, difference or count of topics");
    expect(progressNumbers([30, 81, 46, 57, 81, null, undefined])).toEqual([30, 81, 46, 57]);
  });
});

describe("glosses stay in the answer language (r1-ex-wrong-choice-tr)", () => {
  it("drops Cyrillic bracket items from a Turkish answer and keeps the Turkish gloss", () => {
    expect(stripForeignScriptGlosses("Bradykardie (брадикардия, yavaş kalp atışı) bu soruda yanlış.", "tr")).toBe("Bradykardie (yavaş kalp atışı) bu soruda yanlış.");
    expect(stripForeignScriptGlosses("Bradykardie (брадикардия) ist falsch.", "de")).toBe("Bradykardie ist falsch.");
    expect(stripForeignScriptGlosses("Brady (брадикардия) stays.", "ru")).toBe("Brady (брадикардия) stays.");
    expect(stripForeignScriptGlosses("No brackets here.", "tr")).toBe("No brackets here.");
    expect(stripForeignScriptGlosses("(брадикардия) yanlış seçenek.", "tr")).toBe("yanlış seçenek.");
    expect(stripForeignScriptGlosses("Satz.\n(брадикардия) yanlış.\n  - madde (öğe)", "tr")).toBe("Satz.\nyanlış.\n  - madde (öğe)");
    expect(stripForeignScriptGlosses("Bradykardie (yavaş; брадикардия; kalp atışı)", "tr")).toBe("Bradykardie (yavaş; kalp atışı)");
    expect(stripForeignScriptGlosses("Hypoglykämie (نقص السكر, low blood sugar)", "ar")).toBe("Hypoglykämie (low blood sugar)");
  });

  it("the validator applies it, without marking the answer replaced", () => {
    const brain = createMentorBrain({ facts: makeLoader(), db: () => fakeDb({}).db });
    const v = brain.validate("@@LANG tr\n@@BLOCK\nBradykardie (брадикардия, yavaş kalp atışı) yanlış seçenek.", []);
    expect(v.blocks.map((b) => b.text).join(" ")).not.toMatch(/[Ѐ-ӿ]/u);
    expect(v.replaced).toBe(false);
  });

  it("the turn context asks for single-language glosses", () => {
    // Gate round 3: explain mode only.
    expect(systemTurnContext(ctx({ lang: "tr", mode: "explain" }))).toContain("Glosses in brackets are tr only: no Cyrillic");
    expect(systemTurnContext(ctx({ lang: "uk", mode: "explain" }))).toContain("Glosses in brackets are uk in Cyrillic");
    expect(systemTurnContext(ctx({ lang: "de", mode: "explain" }))).not.toContain("Glosses in brackets");
  });
});
