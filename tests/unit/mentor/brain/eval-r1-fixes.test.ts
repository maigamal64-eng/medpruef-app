/**
 * Mentor quality loop, round 1 (eval W3-EVALRUN failure causes). One test
 * group per fixed cause; every date and fee is synthetic (2099, odd amounts).
 */
import { describe, it, expect } from "vitest";
import { parseAnswer, trimTruncatedAnswer } from "@/lib/mentor/prompt/protocol";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { allowedKeysFromText, guessLang, maskSourceLabels, stripFactIds, validateAnswer } from "@/lib/mentor/validator";
import { examKeysNamedIn, isDeadlineScoped, sittingFactId, sittingToFact } from "@/lib/mentor/facts-loader";
import { FACTS, SITTINGS, ctx, fact, fakeDb, makeLoader } from "./helpers";

const FEE = FACTS[0]; // 777 EUR, read_on 2099-01-01
const DATES = FACTS[3]; // 2099-03-18 12:00
const SIT = sittingToFact(SITTINGS[0]); // sitting 2099-04-20, window 2099-02-01 to 2099-03-18
const ALL = [FEE, DATES, SIT];
const FALLBACK_DE = "nicht offiziell bestätigt";
const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

const RULE_DEREG = fact({
  id: "fixture.registration.dereg",
  exam_key: "sip5a",
  topic: "registration",
  filing_university: "wien",
  text_de: "Die Abmeldung erfolgt spätestens drei Werktage vor der Prüfung in Med.Campus.",
  text_en: "Deregister in Med.Campus at the latest three working days before the exam.",
  aliases: ["Abmeldung", "abmelden", "deregister"],
});
const REG_WINDOW = fact({
  id: "fixture.registration.window",
  exam_key: "sip5a",
  topic: "registration",
  filing_university: "wien",
  text_de: "Anmeldung vom 1. Februar bis 18. März 2099.",
  text_en: "Registration from 1 February to 18 March 2099.",
});
const DATES_ALL = fact({
  id: "fixture.dates.stp-sittings",
  exam_key: "stichprobentest",
  topic: "dates",
  filing_university: "all",
  text_de: "Der Stichprobentest findet am 6. Mai 2099 in Wien statt.",
  text_en: "The Stichprobentest takes place on 6 May 2099 in Vienna.",
});
const NOT_PUBLISHED = fact({
  id: "fixture.dates.graz-none",
  exam_key: "stichprobentest",
  topic: "dates",
  filing_university: "graz",
  verdict: "not_in_sources",
  text_de: "Nicht offiziell bestätigt: Graz hat keine eigenen Fristen veröffentlicht.",
  text_en: "Not officially confirmed: Graz has published no own deadlines.",
});

describe("protocol: footer-style citations (Haiku writes the facts line after the text)", () => {
  it("text before the first facts line borrows that line's ids", () => {
    const p = parseAnswer("@@LANG de\nDie Prüfung ist am 20. April 2099.\n@@BLOCK facts=a,b\nKurzer Satz ohne Werte.\n@@BLOCK");
    expect(p.blocks).toEqual([
      { text: "Die Prüfung ist am 20. April 2099.", factIds: ["a", "b"] },
      { text: "Kurzer Satz ohne Werte.", factIds: ["a", "b"] },
    ]);
  });

  it("a trailing bare @@BLOCK used as a closing tag adds no block", () => {
    const p = parseAnswer("@@LANG en\n@@BLOCK facts=a\nText.\n@@BLOCK");
    expect(p.blocks).toEqual([{ text: "Text.", factIds: ["a"] }]);
  });

  it("text under a bare @@BLOCK borrows the next facts line; header-first blocks keep their own ids", () => {
    const p = parseAnswer("@@BLOCK facts=a\nEins.\n@@BLOCK\nZwei.\n@@BLOCK facts=c\nDrei.");
    expect(p.blocks.map((b) => b.factIds)).toEqual([["a"], ["c"], ["c"]]);
  });

  it("uncited text with no facts line after it stays uncited", () => {
    const p = parseAnswer("@@LANG de\n@@BLOCK facts=a\nEins.\n@@BLOCK\nZwei.");
    expect(p.blocks[1]).toEqual({ text: "Zwei.", factIds: [] });
  });

  it("validator keeps a correct date written above its facts line (dl-sip4a-next-de shape)", () => {
    const id = sittingFactId(SITTINGS[0]);
    const raw = `@@LANG de\nDie nächste SIP5a ist am 20. April 2099, Anmeldung bis 18. März 2099.\n@@BLOCK facts=${id}\nDie Anmeldung läuft über die Universität.\n@@BLOCK`;
    const v = validateAnswer(raw, ALL);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toContain("20. April 2099");
    expect(v.blocks[0].fact_ids).toEqual([id]);
  });

  it("safety holds: an invented date above a facts line is still replaced", () => {
    const raw = `@@LANG de\nDie Prüfung ist am 21. April 2099.\n@@BLOCK facts=${sittingFactId(SITTINGS[0])}\n@@BLOCK`;
    const v = validateAnswer(raw, ALL);
    expect(v.replaced).toBe(true);
    expect(v.blocks[0].text).toMatch(/nicht offiziell bestätig/);
    expect(v.rejected).toContainEqual({ value: "21. April 2099", reason: "not_in_cited_facts" });
  });
});

describe("validator: the read-on date of a cited fact is allowed", () => {
  for (const stand of ["Stand 2099-01-01", "Stand 01.01.2099", "read on 1 January 2099", "read 1 Jan 2099"]) {
    it(`keeps "${stand}" next to the cited value`, () => {
      const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${FEE.id}\nDie Gebühr beträgt 777 EUR (${stand}).`, ALL);
      expect(v.replaced).toBe(false);
      expect(v.rejected).toEqual([]);
    });
  }

  it("only the full date: the read-on month alone is not a supported value", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${FEE.id}\nDie Gebühr wird im Januar 2099 fällig.`, ALL);
    expect(v.replaced).toBe(true);
  });

  it("a block that cites nothing may not carry a read-on date", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK\nStand 2099-01-01.`, ALL);
    expect(v.replaced).toBe(true);
  });
});

describe("validator: fact ids written into the prose", () => {
  it("removes an internal status id with a UUID and reads none of its digits as values", () => {
    const raw = `@@LANG de\n@@BLOCK facts=${DATES.id}\nDie Anmeldung endet am 2099-03-18 (status.00000000-0000-4000-9000-000000000009.sip5a.all).`;
    const v = validateAnswer(raw, ALL);
    expect(v.rejected).toEqual([]);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toBe("Die Anmeldung endet am 2099-03-18.");
  });

  it("removes a cited data id, keeps ordinary dotted words, e-mails and links", () => {
    const known = (id: string) => id === "sip5a.dates.2099-04";
    expect(stripFactIds("Laut sip5a.dates.2099-04 gilt das.", known)).toBe("Laut gilt das.");
    expect(stripFactIds("Das gilt z.B. hier.", known)).toBe("Das gilt z.B. hier.");
    expect(stripFactIds("Mail an pruefung@meduniwien.ac.at senden.", known)).toBe("Mail an pruefung@meduniwien.ac.at senden.");
    expect(stripFactIds("Mein progress.The end", known)).toBe("Mein progress.The end");
  });
});

describe("validator: '12 Uhr' is the same time as '12:00'", () => {
  it("accepts '12 Uhr' against a fact that says 12:00", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${DATES.id}\nAnmeldeschluss 2099-03-18 um 12 Uhr.`, ALL);
    expect(v.replaced).toBe(false);
  });
  it("still rejects '13 Uhr'", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${DATES.id}\nAnmeldeschluss 2099-03-18 um 13 Uhr.`, ALL);
    expect(v.replaced).toBe(true);
  });
});

describe("validator: fallback language when @@LANG is missing", () => {
  it("a German answer without @@LANG gets the German fallback, not the English one", () => {
    const v = validateAnswer("@@BLOCK\nDie Prüfung ist am 21. April 2099 und du musst dich bitte rechtzeitig anmelden.", ALL);
    expect(v.blocks[0].text).toContain(FALLBACK_DE);
  });
  it("guesses de and en, and gives up on too little text", () => {
    expect(guessLang("Die Anmeldung ist nicht offen und du musst warten.")).toBe("de");
    expect(guessLang("The window is not open and you have to wait for the next one.")).toBe("en");
    expect(guessLang("OK")).toBeNull();
  });
});

describe("BRAIN reachability of registration rules", () => {
  it("a university-scoped registration rule without a date is not deadline-scoped; one with a date is", () => {
    expect(isDeadlineScoped(RULE_DEREG)).toBe(false);
    expect(isDeadlineScoped(REG_WINDOW)).toBe(true);
    expect(isDeadlineScoped(fact({ id: "x", topic: "registration", filing_university: "wien", deadline_type: "registration" }))).toBe(true);
    expect(isDeadlineScoped(fact({ id: "y", topic: "dates", filing_university: "wien" }))).toBe(true);
  });

  it("search_facts finds the rule and the fact sheet carries it, the dated window stays out of both", async () => {
    const loader = makeLoader([...FACTS, RULE_DEREG, REG_WINDOW]);
    const brain = createMentorBrain({ facts: loader, db: () => fakeDb({}).db });
    const r = await brain.runTool("search_facts", { query_de: "SIP5a abmelden Abmeldung", exam_key: "sip5a" }, ctx());
    expect(r.factIds).toContain(RULE_DEREG.id);
    expect(r.factIds).not.toContain(REG_WINDOW.id);
    const sheet = loader.sheetFacts(ctx().now).map((f) => f.id);
    expect(sheet).toContain(RULE_DEREG.id);
    expect(sheet).not.toContain(REG_WINDOW.id);
  });

  it("get_dates names the rule ids first, so sittings can never crowd them out", async () => {
    const loader = makeLoader([...FACTS, RULE_DEREG]);
    const brain = createMentorBrain({ facts: loader, db: () => fakeDb({}).db });
    const r = await brain.runTool("get_dates", { exam_key: "sip5a", filing_university: "wien" }, ctx());
    const body = parse(r.content) as { registration_rules: Array<{ fact_id: string; in_fact_sheet: boolean }> };
    expect(body.registration_rules).toEqual([{ fact_id: RULE_DEREG.id, in_fact_sheet: true }]);
    expect(r.factIds[0]).toBe(RULE_DEREG.id);
    expect(r.factIds).toContain(sittingFactId(SITTINGS[0]));
  });

  it("get_dates lists the gaps the sources name as not officially confirmed", async () => {
    const loader = makeLoader([...FACTS, NOT_PUBLISHED]);
    const brain = createMentorBrain({ facts: loader, db: () => fakeDb({}).db });
    const r = await brain.runTool("get_dates", { exam_key: "stichprobentest", filing_university: "graz" }, ctx());
    const body = parse(r.content) as { unconfirmed: Array<{ fact_id: string; status: string }>; no_verified_date: boolean };
    expect(body.no_verified_date).toBe(true);
    expect(body.unconfirmed).toEqual([expect.objectContaining({ fact_id: NOT_PUBLISHED.id, status: "not officially confirmed" })]);
    expect(r.factIds).not.toContain(NOT_PUBLISHED.id);
  });

  it("asking for the filing university points to search_facts for sitting dates and leaks no date", async () => {
    const loader = makeLoader([...FACTS, DATES_ALL]);
    const brain = createMentorBrain({ facts: loader, db: () => fakeDb({}).db });
    const r = await brain.runTool("get_dates", { exam_key: "stichprobentest", filing_university: "all" }, ctx());
    const body = parse(r.content);
    expect(body.needs_filing_university).toBe(true);
    expect(String(body.sitting_dates_hint)).toMatch(/search_facts/);
    expect(String(body.instruction)).toMatch(/question mark/);
    expect(r.content).not.toMatch(/2099/);
    const s = await brain.runTool("search_facts", { query_de: "Stichprobentest Termin", exam_key: "stichprobentest", topic: "dates" }, ctx());
    expect(s.factIds).toContain(DATES_ALL.id);
  });
});

describe("get_question on a question the learner may not open", () => {
  it("tells the model to refuse with no_verified_source and not to repeat the id", async () => {
    const brain = createMentorBrain({ facts: makeLoader(), db: () => fakeDb({}).db, canFreeRead: async () => false });
    const r = await brain.runTool("get_question", { id: 9000011 }, ctx({ paidAccess: false }));
    expect(r.isError).toBe(true);
    const body = parse(r.content);
    expect(String(body.instruction)).toContain("@@REFUSE reason=no_verified_source");
    expect(r.content).not.toContain("9000011");
  });
});

describe("prompt: answer shape", () => {
  it("states header-first with no closing marker and @@LANG first", () => {
    expect(MENTOR_CORE_PROMPT).toContain("Each @@BLOCK line comes BEFORE the text it covers");
    expect(MENTOR_CORE_PROMPT).toContain("never end the answer with @@BLOCK");
    expect(MENTOR_CORE_PROMPT).toContain("the @@LANG line is always the first line");
  });
  it("leads with the direct answer, answers only what was asked, and fixes the gap wording", () => {
    expect(MENTOR_CORE_PROMPT).toContain("The first sentence is the direct answer");
    expect(MENTOR_CORE_PROMPT).toContain("Answer only what was asked");
    expect(MENTOR_CORE_PROMPT).toContain('"nicht offiziell bestätigt"');
    expect(MENTOR_CORE_PROMPT).toContain('"not officially confirmed"');
  });
  it("asks the filing university as a real question and keeps ids out of the text", () => {
    expect(MENTOR_CORE_PROMPT).toContain("ends with a question mark");
    expect(MENTOR_CORE_PROMPT).toContain("Never write links, fact ids");
  });
});

describe("validator: a fact range names its year once (dl-rez-jan)", () => {
  const RANGE = fact({
    id: "fixture.dates.range",
    exam_key: "rezeptierkunde",
    topic: "dates",
    filing_university: "all",
    text_de: "Prüfungswoche 18. Januar bis 22. Januar 2099. Anmeldezeitraum 2. Dezember bis 15. Dezember 2098.",
    text_en: "Exam week 18 Jan to 22 Jan 2099. Registration window 2 Dec to 15 Dec 2098.",
  });
  const say = (t: string) => validateAnswer(`@@LANG de\n@@BLOCK facts=${RANGE.id}\n${t}`, [RANGE]);

  it("the start date of the range carries the range's year", () => {
    const keys = allowedKeysFromText(`${RANGE.text_de}\n${RANGE.text_en}`);
    expect(keys.has("d:2099-01-18")).toBe(true);
    expect(keys.has("d:2098-12-02")).toBe(true);
  });

  for (const t of [
    "Die Prüfungswoche ist 18. bis 22. Januar 2099.",
    "Die Prüfung beginnt am 18. Januar 2099.",
    "Exam week 18 to 22 January 2099.",
    "Beginn am 18.01.2099.",
    "Anmeldung ab 2. Dezember 2098.",
  ]) {
    it(`keeps "${t}"`, () => {
      const v = say(t);
      expect(v.rejected).toEqual([]);
      expect(v.replaced).toBe(false);
    });
  }

  for (const t of ["Die Prüfung beginnt am 18. Februar 2099.", "Die Prüfung beginnt am 18. Januar 2100.", "Anmeldung ab 2. Dezember 2099."]) {
    it(`still replaces "${t}"`, () => {
      expect(say(t).replaced).toBe(true);
    });
  }

  it("a start month after the end month belongs to the year before", () => {
    const keys = allowedKeysFromText("Ferien vom 28. Dezember bis 5. Januar 2099.");
    expect(keys.has("d:2098-12-28")).toBe(true);
    expect(keys.has("d:2099-12-28")).toBe(false);
  });

  it("two separate dates with no range word do not borrow a year", () => {
    const keys = allowedKeysFromText("Am 18. Januar ist Anmeldung. Die Prüfung ist am 22. Februar 2099.");
    expect(keys.has("d:2099-01-18")).toBe(false);
  });
});

describe("search_facts: topic ranks, it does not exclude (pr-prescribed)", () => {
  const ALWAYS = fact({
    id: "fixture.documents.always",
    exam_key: "sip5a",
    topic: "documents",
    filing_university: "all",
    text_de: "Die Ergänzungsprüfung ist unabhängig vom Ergebnis stets vorzuschreiben.",
    text_en: "The supplementary exam is always prescribed, whatever the result.",
    aliases: ["stets", "Pflicht", "always"],
  });

  it("a fact under another topic is still found when the query matches, after the on-topic facts", async () => {
    const loader = makeLoader([...FACTS, ALWAYS]);
    const r = loader.searchDetailed("Ergänzungsprüfung Pflicht stets", "sip5a", "format", ctx().now);
    expect(r.facts.map((f) => f.id)).toContain(ALWAYS.id);
    const onTopic = r.facts.filter((f) => f.topic === "format").length;
    expect(r.facts.slice(0, onTopic).every((f) => f.topic === "format")).toBe(true);
  });

  it("a topic-only lookup (no query words) still filters exactly", () => {
    const loader = makeLoader([...FACTS, ALWAYS]);
    const r = loader.searchDetailed("", "sip5a", "format", ctx().now);
    expect(r.facts.every((f) => f.topic === "format")).toBe(true);
  });

  it("deadline-scoped facts stay out even when the topic is off", () => {
    const loader = makeLoader([...FACTS, ALWAYS]);
    const r = loader.searchDetailed("Anmeldung Frist", "sip5a", "format", ctx().now);
    expect(r.facts.some((f) => isDeadlineScoped(f))).toBe(false);
  });
});

describe("answer cut off by the output cap", () => {
  it("drops a partial marker line and the unfinished sentence", () => {
    const raw = "@@LANG de\n@@BLOCK facts=a\nDie Prüfung ist am 20. April 2099. Die Anmeldung erfolgt per E-Mail an\n@@BLOCK facts=rezeptierkunde.dates.";
    expect(trimTruncatedAnswer(raw)).toBe("@@LANG de\n@@BLOCK facts=a\nDie Prüfung ist am 20. April 2099.");
  });
  it("drops a last text line with no complete sentence, keeps earlier lines", () => {
    expect(trimTruncatedAnswer("@@LANG en\n@@BLOCK facts=a\n- One done.\n- Two is cut mid")).toBe("@@LANG en\n@@BLOCK facts=a\n- One done.");
  });
  it("leaves nothing when nothing is complete", () => {
    expect(trimTruncatedAnswer("@@LANG en\n@@BLOCK facts=a\n- Yes. The exam week is 18 to 22 January 2099 (M")).toBe("@@LANG en\n@@BLOCK facts=a\n- Yes.");
    expect(trimTruncatedAnswer("-")).toBe("");
  });
});

describe("prompt: round-1 additions", () => {
  it("forbids echoing the learner's own values and leads price answers with the plans", () => {
    expect(MENTOR_CORE_PROMPT).toContain("Do not repeat a date, month, number or amount from the learner's message");
    expect(MENTOR_CORE_PROMPT).toContain("do not name November");
    expect(MENTOR_CORE_PROMPT).toContain("give the plan prices from app.billing.plans first");
  });
});

describe("search_facts: exams named in the query join the exam scope (pr-prescribed)", () => {
  const PHARMA = fact({
    id: "fixture.documents.pharma-always",
    exam_key: "rezeptierkunde",
    topic: "documents",
    filing_university: "all",
    text_de: "Die Ergänzungsprüfung Rezeptierkunde ist stets vorzuschreiben.",
    text_en: "The supplementary exam in Rezeptierkunde is always prescribed.",
    aliases: ["Rezeptierkunde", "stets", "always"],
  });

  it("names exams by their German words, never infers c1, general or fsp", () => {
    expect([...examKeysNamedIn("Rezeptierkunde Pflicht nach Stichprobentest")].sort()).toEqual(["rezeptierkunde", "stichprobentest"]);
    expect([...examKeysNamedIn("Gerichtliche Medizin Termin SIP5a")].sort()).toEqual(["gerichtsmedizin", "sip5a"]);
    expect(examKeysNamedIn("Deutsch C1 Nachweis Gebühr").size).toBe(0);
  });

  it("an exam_key search reaches a named second exam's fact, and not an unnamed one's", () => {
    const loader = makeLoader([...FACTS, PHARMA]);
    const hit = loader.searchDetailed("Rezeptierkunde stets Pflicht Stichprobentest bestanden", "stichprobentest", undefined, ctx().now);
    expect(hit.facts.map((f) => f.id)).toContain(PHARMA.id);
    const miss = loader.searchDetailed("stets Pflicht bestanden", "stichprobentest", undefined, ctx().now);
    expect(miss.facts.map((f) => f.id)).not.toContain(PHARMA.id);
  });
});

describe("prompt: round-1 retrieval and refusal rules", () => {
  it("routes later SIP and supplementary-exam sittings to get_dates, searches before 'not confirmed', refuses statistics", () => {
    expect(MENTOR_CORE_PROMPT).toContain("sittings and registration windows (also later ones");
    expect(MENTOR_CORE_PROMPT).toContain("come only from get_dates; call it with filing_university all");
    expect(MENTOR_CORE_PROMPT).toContain("Before you say something is not officially confirmed, call search_facts");
    expect(MENTOR_CORE_PROMPT).toContain("refuse with @@REFUSE reason=no_verified_source and add nothing else");
    expect(MENTOR_CORE_PROMPT).toContain("Do not add a rule, percentage or number the learner did not ask about");
  });
  it("study plans use words, not numbered phases (a bare '1' is an unbacked number)", () => {
    expect(MENTOR_CORE_PROMPT).toContain('Do not number phases, weeks or steps ("Phase 1", "Woche 2")');
    expect(MENTOR_CORE_PROMPT).toContain("in the learner's language (de: \"Zuerst\"");
    expect(MENTOR_CORE_PROMPT).toContain("do not mention guarantees or chances of success at all");
    const v = validateAnswer(`@@LANG en\n@@BLOCK facts=${FEE.id}\n- Phase 1: pay the 777 EUR fee.`, ALL);
    expect(v.replaced).toBe(true);
  });
  it("keeps explain and study in scope whatever exam label the tools return (live run 3 regression)", () => {
    expect(MENTOR_CORE_PROMPT).toContain("Explaining a question (get_question) and study planning (get_my_progress) are always in scope");
    expect(MENTOR_CORE_PROMPT).not.toMatch(/such as the Ärztekammer Kenntnisprüfung/);
  });
});

describe("validator: a quoted source name of a cited fact is not a value (dl-rez-next-en)", () => {
  const LABELLED = fact({
    id: "fixture.dates.labelled",
    exam_key: "rezeptierkunde",
    topic: "dates",
    filing_university: "all",
    source_label: "MedUni Wien, Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2098/99",
    text_de: "Prüfungswoche 23. November bis 27. November 2098.",
    text_en: "Exam week 23 Nov to 27 Nov 2098.",
  });
  const say = (t: string, facts = [LABELLED]) => validateAnswer(`@@LANG en\n@@BLOCK facts=${facts.map((f) => f.id).join(",")}\n${t}`, [LABELLED, FEE]);

  it("keeps the sentence that quotes the label, with or without the publisher", () => {
    for (const t of [
      "The exam week is 23 to 27 November 2098. Source: MedUni Wien, Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2098/99.",
      "The exam week is 23 to 27 November 2098 (Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2098/99).",
    ]) {
      const v = say(t);
      expect(v.rejected).toEqual([]);
      expect(v.replaced).toBe(false);
    }
  });

  it("the label's digits used as a claim elsewhere are still replaced", () => {
    expect(say("The exam has 99 questions. Source: Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2098/99.").replaced).toBe(true);
  });

  it("a label of a fact the block does not cite is not masked", () => {
    expect(say("Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2098/99.", [FEE]).replaced).toBe(true);
  });

  it("masks with equal length so value positions stay aligned", () => {
    const t = "Am 23. November 2098 (Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2098/99) beginnt es.";
    const m = maskSourceLabels(t, [LABELLED]);
    expect(m.length).toBe(t.length);
    expect(m).not.toContain("2098/99");
    expect(m.startsWith("Am 23. November 2098 (")).toBe(true);
  });
});
