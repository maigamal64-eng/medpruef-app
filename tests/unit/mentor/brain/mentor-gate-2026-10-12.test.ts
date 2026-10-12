/**
 * Live trust gate, 12 Oct 2026 (a-mentor-gate). One group per cause of the
 * failing live slices: Graz deadlines, unasked later sittings, the closing line
 * of a not-yet-open window, deadline-first order in every language, hints on
 * answered questions, the Arabic fallback, and grounding of restated values.
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { buildTurnContext, MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { trimForDeadlineGap, trimUnaskedValues, validateAnswer, extractValues } from "@/lib/mentor/validator";
import { unsafeExplainBackground } from "@/lib/mentor/explain-safety";
import { deadlineGapUniversity, deadlineLinesFromTools, hoistDeadlineLine } from "@/lib/mentor/deadline-first";
import { daysPhrase } from "@/lib/mentor/deadline-copy";
import type { MentorFact, ValidatedAnswer } from "@/lib/mentor/seam";
import { ctx, fact, fakeDb } from "./helpers";

const L = getMentorFactsLoader();
const now = new Date("2026-10-12T08:00:00Z");
const brain = () => createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

function answer(blocks: Array<{ text: string; fact_ids: string[] }>): ValidatedAnswer {
  return { blocks, citations: [], replaced: false, rejected: [] };
}

describe("Graz filers get no other publisher's dates (dl-stp-graz-*, r1-gap-graz-*)", () => {
  for (const month of [undefined, "2027-02", "2027-05", "2027-09"]) {
    it(`get_dates(stichprobentest, graz${month ? `, ${month}` : ""}) returns the gap only`, async () => {
      const r = await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "graz", ...(month ? { month } : {}) }, ctx({ now }));
      const body = parse(r.content);
      expect(body.no_verified_date).toBe(true);
      expect(body.sittings).toEqual([]);
      expect(body.facts).toEqual([]);
      expect((body.unconfirmed as Array<{ fact_id: string }>).map((u) => u.fact_id)).toEqual(["stichprobentest.dates.graz-own-cutoffs"]);
      expect(r.content).not.toMatch(/2027-0[2-9]-\d\d|2026-12-14|Innsbruck|Wien|Vienna/);
      expect(r.factIds).toEqual([]);
    });
  }

  it("Wien and Innsbruck filers still get their own rows", async () => {
    for (const fu of ["wien", "innsbruck"]) {
      const body = parse((await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: fu, month: "2027-02" }, ctx({ now }))).content);
      expect((body.sittings as Array<{ date: string }>).map((s) => s.date)).toEqual(["2027-02-03"]);
    }
  });

  it("the gap branch needs a gap fact of that university (no SIP gap row exists for Graz)", async () => {
    const body = parse((await brain().runTool("get_dates", { exam_key: "sip4a", filing_university: "graz" }, ctx({ now }))).content);
    expect(String(body.instruction ?? "")).not.toContain("has not published its own deadline");
  });
});

describe("a not-yet-open window keeps its closing line (dl-rez-jan-en)", () => {
  it("the status fact carries the same days count as the deadline template", async () => {
    const b = brain();
    const r = await b.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien", month: "2027-01" }, ctx({ now, lang: "en" }));
    const body = parse(r.content);
    const row = (body.sittings as Array<{ fact_id: string; deadline_template: { closing_line: string; sitting_line: string }; registration_status: string }>)[0];
    expect(row.registration_status).toBe("not_yet_open");
    expect(row.deadline_template.closing_line).toContain("64 days left");
    const statusId = body.status_fact_id as string;
    const raw = `@@LANG en\n@@BLOCK facts=${row.fact_id},${statusId}\n${row.deadline_template.closing_line}\n${row.deadline_template.sitting_line}`;
    const cited = await L.byIds(r.factIds, now);
    const v = b.validate(raw, cited, r.factIds);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toContain("December 15, 2026, 64 days left");
  });

  it("a block that cites only the sitting row may state its computed days (r4-deadline-first-uk)", async () => {
    const b = brain();
    const r = await b.runTool("get_dates", { exam_key: "sip4a", filing_university: "all" }, ctx({ now, lang: "uk" }));
    const row = (parse(r.content).sittings as Array<{ fact_id: string; deadline_template: { closing_line: string } }>)[0];
    const v = b.validate(`@@LANG uk\n@@BLOCK facts=${row.fact_id}\n${row.deadline_template.closing_line}`, await L.byIds(r.factIds, now), r.factIds);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toBe(row.deadline_template.closing_line);
  });
});

describe("deadline first in every language (r4-deadline-first-uk/tr/fr)", () => {
  const t = { closing_line: "**Kayıt SIP4a (MedUni Vienna): son tarih 19 Ekim 2026, 7 gün kaldı (açık).**", sitting_line: "Sınav tarihi: 18 Kasım 2026." };

  it("moves the closing line and its sitting line to the top of the answer", () => {
    const v = answer([
      { text: "Bir sonraki SIP4a sınavı 18 Kasım 2026'da yapılacak.", fact_ids: ["a"] },
      { text: `${t.closing_line}\n${t.sitting_line}`, fact_ids: ["b"] },
    ]);
    const out = hoistDeadlineLine(v, [t]);
    expect(out.blocks.map((b) => b.fact_ids[0])).toEqual(["b", "a"]);
    expect(out.blocks[0].text.split("\n")[0]).toBe(t.closing_line);
    const inBlock = hoistDeadlineLine(answer([{ text: `Önce bir cümle.\n${t.closing_line}\n${t.sitting_line}`, fact_ids: ["a"] }]), [t]);
    expect(inBlock.blocks[0].text).toBe(`${t.closing_line}\n${t.sitting_line}\nÖnce bir cümle.`);
  });

  it("changes nothing when the line is already first, appears twice or is missing", () => {
    const first = answer([{ text: `${t.closing_line}\nmore`, fact_ids: [] }]);
    expect(hoistDeadlineLine(first, [t])).toBe(first);
    const other = { closing_line: "**Kayıt SIP5a: son tarih 19 Ekim 2026.**", sitting_line: "x" };
    const two = answer([{ text: "prose", fact_ids: [] }, { text: t.closing_line, fact_ids: [] }, { text: other.closing_line, fact_ids: [] }]);
    expect(hoistDeadlineLine(two, [t, other])).toBe(two);
    const none = answer([{ text: "prose", fact_ids: [] }]);
    expect(hoistDeadlineLine(none, [t])).toBe(none);
  });

  it("reads templates from get_dates results only", () => {
    const res = { content: JSON.stringify({ sittings: [{ deadline_template: t }, { deadline_template: null }] }), factIds: [] };
    expect(deadlineLinesFromTools([{ name: "get_dates", result: res }, { name: "search_facts", result: res }])).toEqual([t]);
    expect(deadlineLinesFromTools([{ name: "get_dates", result: { content: "not json", factIds: [] } }])).toEqual([]);
  });

  it("the prompt asks for the closing line first in every language", () => {
    expect(MENTOR_CORE_PROMPT).toContain("the closing_line is the first line of the whole answer");
  });

  it("days-left phrases agree in number", () => {
    expect(daysPhrase("de", 1)).toBe("noch 1 Tag");
    expect(daysPhrase("en", 1)).toBe("1 day left");
    expect(daysPhrase("ru", 63)).toBe("осталось 63 дня");
    expect(daysPhrase("ru", 7)).toBe("осталось 7 дней");
    expect(daysPhrase("ru", 21)).toBe("остался 21 день");
    expect(daysPhrase("uk", 63)).toBe("залишилося 63 дні");
    expect(daysPhrase("fr", 1)).toBe("1 jour restant");
    expect(daysPhrase("tr", 7)).toBe("7 gün kaldı");
  });
});

describe("a general question gets the next sitting only (r3-starter-pharma-en)", () => {
  const resolve = (id: string) => L.peek(id, now);

  it("drops the January week, keeps November", async () => {
    const b = brain();
    const r = await b.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien" }, ctx({ now, lang: "en" }));
    const resolve = (id: string) => b.resolveFact(id);
    const v = answer([
      { text: "The next sitting is the exam week of November 23 to 27, 2026.\n**Registration until October 20, 2026.**", fact_ids: ["sitting.rezeptierkunde.2026-11-23.wien.registration", "rezeptierkunde.dates.2026-11"] },
      { text: "The following sitting is January 18 to 22, 2027.\n**Registration Rezeptierkunde: until December 15, 2026.**\nSitting: January 18, 2027.", fact_ids: ["sitting.rezeptierkunde.2027-01-18.wien.registration", "rezeptierkunde.dates.2027-01"] },
    ]);
    const out = trimUnaskedValues(v, { question: "When are the pharmacology exams?", lang: "en", resolve, retrievedIds: r.factIds });
    const text = out.blocks.map((b) => b.text).join("\n");
    expect(text).toContain("November 23 to 27, 2026");
    expect(text).toContain("October 20, 2026");
    expect(text).not.toMatch(/January|December 15/);
  });

  it("keeps later sittings when the learner asks for them, and never trims without the computed status", async () => {
    const b = brain();
    const r = await b.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien" }, ctx({ now, lang: "en" }));
    const resolveB = (id: string) => b.resolveFact(id);
    const v = answer([
      { text: "November 23, 2026.", fact_ids: ["sitting.rezeptierkunde.2026-11-23.wien.registration"] },
      { text: "January 18, 2027.", fact_ids: ["sitting.rezeptierkunde.2027-01-18.wien.registration"] },
    ]);
    for (const question of ["When is the next Rezeptierkunde exam and the one after it?", "Welche Termine gibt es für Rezeptierkunde?", "Rezeptierkunde dates 2027?"]) {
      expect(trimUnaskedValues(v, { question, lang: "en", resolve: resolveB, retrievedIds: r.factIds })).toBe(v);
    }
    // The loader alone cannot see the status: no closed/open knowledge, no trim.
    expect(trimUnaskedValues(v, { question: "When are the pharmacology exams?", lang: "en", resolve, retrievedIds: r.factIds })).toBe(v);
  });

  it("a closed window keeps the next sitting after it", async () => {
    const after = new Date("2026-10-21T08:00:00Z");
    const b = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => after });
    const r = await b.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien" }, ctx({ now: after, lang: "en" }));
    const resolveAt = (id: string) => b.resolveFact(id);
    const v = answer([
      { text: "Registration for November closed on October 20, 2026.", fact_ids: ["sitting.rezeptierkunde.2026-11-23.wien.registration"] },
      { text: "The next open one is January 18, 2027.", fact_ids: ["sitting.rezeptierkunde.2027-01-18.wien.registration"] },
    ]);
    expect(trimUnaskedValues(v, { question: "When are the pharmacology exams?", lang: "en", resolve: resolveAt, retrievedIds: r.factIds })).toBe(v);
  });
});

describe("explain: hint fields only for unanswered questions (r3-explain-gloss-1-ru)", () => {
  it("an answered question has no explain_action in the turn context", () => {
    const answered = buildTurnContext(ctx({ mode: "explain", questionId: 9000001, lang: "ru" }));
    expect(answered).toContain("answered=true");
    expect(answered).not.toContain("explain_action");
    const open = buildTurnContext(ctx({ mode: "explain", questionId: 9000001, answered: false }));
    expect(open).toContain("explain_action=hint");
    expect(open).toContain("hints_used=0");
  });

  it("the gloss shape is spelled out: German term first, gloss only inside the brackets", () => {
    expect(MENTOR_CORE_PROMPT).toContain("The German term comes first, outside the brackets");
    expect(MENTOR_CORE_PROMPT).toContain("uses exactly the learner's spelling and ending");
  });

  it("background rules name digits inside names and number words", () => {
    expect(MENTOR_CORE_PROMPT).toContain('not even inside a name (write "the vitamin", not "B12")');
  });
});

describe("Arabic stays on the English fallback (pick-arabic A)", () => {
  it("the turn context asks for English for ar and the learner's language otherwise", () => {
    expect(buildTurnContext(ctx({ lang: "ar" }))).toContain("Answer in English");
    expect(buildTurnContext(ctx({ lang: "ru" }))).toContain("Answer in ru");
  });
});

describe("restated values stay grounded (precision false replacements)", () => {
  const PASS = fact({ id: "fixture.pass.field", exam_key: "stichprobentest", topic: "pass_rule", text_de: "Ein Fach gilt ab 63 Prozent als bestanden.", text_en: "A field passes from 63 percent." });
  const DATES = fact({ id: "fixture.dates.week", topic: "dates", text_de: "Prüfungswoche 23. bis 27. November 2099.", text_en: "Exam week 23 Nov to 27 Nov 2099." });

  it("citations stay per block: a restatement must cite again (prompt), an uncited one is still replaced", () => {
    expect(MENTOR_CORE_PROMPT).toContain("A closing sentence that repeats a value from an earlier block cites that fact again");
    const v = validateAnswer("@@LANG de\n@@BLOCK facts=fixture.pass.field\nEin Fach gilt ab 63 Prozent als bestanden.\n@@BLOCK\nDie 63-Prozent-Regel gilt pro Fach.", [PASS]);
    expect(v.replaced).toBe(true);
  });

  it("month-first ranges are dates, not bare numbers", () => {
    expect(extractValues("January 18 to 22, 2027").flatMap((x) => x.keys)).toEqual(["d:2027-01-18", "d:2027-01-22"]);
    const v = validateAnswer("@@LANG en\n@@BLOCK facts=fixture.dates.week\nThe exam week is November 23 to 27, 2099.", [DATES]);
    expect(v.replaced).toBe(false);
  });

  it("an uncited study block is grounded on the learner's own progress", () => {
    const progress: MentorFact = fact({ id: "progress.u1.snapshot", exam_key: "general", topic: "glossary", text_de: "Noch 37 Tage bis zur Prüfung. Neurologie 36 Prozent.", text_en: "37 days left. Neurology 36 percent." });
    const resolve = (id: string) => (id === progress.id ? progress : null);
    const v = validateAnswer("@@LANG de\n@@BLOCK\nIhnen bleiben noch 37 Tage. Zuerst Neurologie (36 Prozent richtig).", [], { resolve, retrievedIds: [progress.id] });
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toContain("37 Tage");
    expect(v.blocks[0].fact_ids).toEqual([]);
    const without = validateAnswer("@@LANG de\n@@BLOCK\nIhnen bleiben noch 37 Tage.", [], { resolve });
    expect(without.replaced).toBe(true);
  });
});

describe("Graz answers keep only the gap (r1-gap-graz-ru/tr, second tool call)", () => {
  it("removes sentences with a day date or another publisher, in any language", () => {
    const v: ValidatedAnswer = {
      blocks: [
        { text: "Срок регистрации для Graz не подтверждён официально. Уточните его у MedUni Graz.", fact_ids: [] },
        { text: "Сам Stichprobentest проводится 22 сентября 2027 года в Graz (источник: i-med).", fact_ids: ["stichprobentest.dates.2027-sittings"] },
        { text: "Kayıt, başvurunun yapıldığı üniversitede yapılır (Quelle: i-med, Innsbruck).", fact_ids: ["stichprobentest.registration.filing-university"] },
      ],
      citations: [{ fact_id: "stichprobentest.dates.2027-sittings", source_label: "i-med", source_url: "https://www.i-med.ac.at/x", read_on: "2026-10-12" }],
      replaced: false,
      rejected: [],
    };
    const out = trimForDeadlineGap(v, "graz");
    expect(out.blocks.map((b) => b.text)).toEqual(["Срок регистрации для Graz не подтверждён официально. Уточните его у MedUni Graz."]);
    expect(out.citations).toEqual([]);
  });

  it("returns the answer unchanged when nothing would remain, and leaves refusals alone", () => {
    const only: ValidatedAnswer = { blocks: [{ text: "Am 22. September 2027 in Wien.", fact_ids: [] }], citations: [], replaced: false, rejected: [] };
    expect(trimForDeadlineGap(only, "graz")).toBe(only);
  });

  it("the gap result names the university for the turn", async () => {
    const r = await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "graz" }, ctx({ now }));
    expect(deadlineGapUniversity([{ name: "get_dates", result: r }])).toBe("graz");
    const w = await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien" }, ctx({ now }));
    expect(deadlineGapUniversity([{ name: "get_dates", result: w }])).toBeNull();
  });
});

describe("background pronoun 'one' (ex-ds-en)", () => {
  it("is not a quantity, a counted thing still is", () => {
    expect(unsafeExplainBackground("Learn the abbreviations by the job each one does on the prescription.")).toBe(false);
    expect(unsafeExplainBackground("Two groups, one involving the marrow and the other the membrane.")).toBe(true);
    expect(unsafeExplainBackground("Bone marrow failure in one, a membrane defect in the other.")).toBe(false);
    expect(unsafeExplainBackground("Take one tablet.")).toBe(true);
    expect(unsafeExplainBackground("Vitamin B12.")).toBe(true);
    // Turkish "on" (ten) is the English preposition too.
    expect(unsafeExplainBackground("The directions go on the label.")).toBe(false);
    expect(unsafeExplainBackground("İlaç on gün boyunca verilir.")).toBe(true);
  });
});
