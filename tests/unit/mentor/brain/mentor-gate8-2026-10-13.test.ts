/**
 * Live trust gate round 8 (a-mentor-gate8), track-A rule decisions of 13 Oct:
 * - the learner's own exam date from their profile row may be restated: a
 *   sentence that names it as their own entry is grounded on the profile row and
 *   rewritten to the code-owned line (review P1: model wording never presents it
 *   as a deadline or an official date), never deleted, never a confirmed date;
 * - "die Rezeptierkunde (Pharmakologie) im Januar" is grounded on the cited
 *   sitting row of the same exam and month, a bracketed exam-name gloss included.
 * Every positive case has a negative twin that must still be deleted.
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { validateAnswer } from "@/lib/mentor/validator";
import { ownExamDateLine } from "@/lib/mentor/trust-copy";
import type { MentorLang } from "@/lib/mentor/contract";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { ctx, fact, fakeDb } from "./helpers";

const L = getMentorFactsLoader();
const now = new Date("2026-10-12T08:00:00Z");
const all = (v: ValidatedAnswer) => v.blocks.map((b) => b.text).join("\n\n");
const NOT_CONFIRMED = /nicht offiziell bestätig|not officially confirmed|can't officially confirm/;

// ─── 1. The learner's own exam date (gate7 run 2 st-spt-de) ────────────────

const PROGRESS_TEXT = [
  "Gewählte Prüfung: stichprobentest",
  "Prüfungsdatum (selbst eingetragen): 2027-02-03, noch 114 Tage",
  "Gesamt: 81 beantwortet, 46 richtig, 57 %",
  "Schwach: Gynäkologie: 14 beantwortet, 36 %",
  "Schwach: HNO: 10 beantwortet, 40 %",
  "Stark: Pädiatrie: 19 beantwortet, 79 %",
  "Stark: Notfallmedizin: 15 beantwortet, 60 %",
].join("\n");
const progress = fact({ id: "progress.00000000-0000-4000-9000-000000000083", exam_key: "general", topic: "glossary", text_de: PROGRESS_TEXT, text_en: PROGRESS_TEXT, read_on: "2026-10-12" });
const study = (raw: string, facts = [progress], retrieved: string[] = [progress.id]) =>
  validateAnswer(raw, facts, { study: true, retrievedIds: retrieved, resolve: (id) => (id === progress.id ? progress : null) });
const uncited = (lang: string, sentence: string, retrieved: string[] = [progress.id]) =>
  study(`@@LANG ${lang}\n@@BLOCK facts=${progress.id}\nAm schwächsten sind Sie in HNO mit 40 %.\n@@BLOCK\n${sentence}`, [progress], retrieved);

describe("the learner's own exam date is grounded on the profile row (gate7 st-spt-de)", () => {
  it("st-spt-de recorded answer: the own-entry sentence becomes the code-owned line, no notice, no confirmed date", () => {
    const raw = `@@LANG de\n@@BLOCK facts=${progress.id}\nAm schwächsten sind Sie in Gynäkologie mit 36 % richtigen Antworten (14 beantwortet) und in HNO mit 40 % (10 beantwortet). Ihr Gesamtergebnis liegt bei 57 % richtig aus 81 beantwortbaren Fragen. Ihr selbst eingetragenes Prüfungsdatum ist der 3. Februar 2027, also noch 114 Tage.\n@@BLOCK facts=${progress.id}\nZuerst sollten Sie Gynäkologie und HNO gezielt üben, da hier die Trefferquote am niedrigsten ist. Danach wiederholen Sie diese Themen in kurzen Einheiten, um die Fehlerquellen zu erkennen. Zum Schluss festigen Sie Ihre Stärken Pädiatrie (79 %) und Notfallmedizin (60 %) mit gemischten Übungsfragen, damit das Wissen über alle Bereiche stabil bleibt.\n@@BLOCK\nDas Datum 3. Februar 2027 ist Ihr eigener Eintrag und keine offizielle Termin- oder Fristangabe.`;
    const v = study(raw);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    // Gate9 P1: the progress row no longer lends its date, also to a block that cites it. The
    // model's own-date sentence in the cited first block becomes the code-owned line; the uncited
    // third block restates the same date and is dropped (the line is shown once per answer).
    const line = "Ihr selbst eingetragenes Prüfungsdatum ist der 3. Februar 2027 (noch 114 Tage); das ist kein offizieller Termin und keine Frist.";
    expect(all(v)).not.toContain("also noch 114 Tage.");
    expect(v.blocks[0].text.endsWith(line)).toBe(true);
    expect(all(v).split(line).length - 1).toBe(1);
    expect(all(v)).not.toContain("ist Ihr eigener Eintrag");
    expect(all(v)).not.toMatch(NOT_CONFIRMED);
    for (const b of v.blocks) expect(b.confirmed_dates).toBeUndefined();
    expect(v.citations).toEqual([]);
  });

  it.each([
    ["de", "Ihr Prüfungsdatum ist der 3. Februar 2027."],
    ["de", "Bis zu Ihrer Prüfung am 3. Februar 2027 bleibt genug Zeit."],
    ["de", "Ihre Prüfung im Februar 2027 ist Ihr eigener Eintrag."],
    ["de", "Den 3. Februar haben Sie selbst eingetragen."],
    ["en", "Your exam date is 3 February 2027."],
    ["en", "The date you entered is February 3, 2027."],
    ["de", "Das Datum 3. Februar 2027 ist Ihr eigener Eintrag und keine offizielle Termin- oder Fristangabe."],
    ["fr", "Votre date d'examen est le 3 février 2027."],
    ["ru", "Ваша дата экзамена: 3 февраля 2027 года."],
    ["uk", "Ваша дата іспиту: 3 лютого 2027 року."],
    ["tr", "Sınav tarihiniz 3 Şubat 2027."],
  ])("restated in code (%s): %s", (lang, sentence) => {
    const v = uncited(lang, sentence);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain(ownExamDateLine(lang as MentorLang, "2027-02-03", 114));
    expect(all(v)).not.toContain(sentence);
    for (const b of v.blocks) expect(b.confirmed_dates).toBeUndefined();
  });

  it.each([
    // Review round 2 P1 probes: whatever happens, the model's wording never reaches the learner;
    // the sentence is either deleted (counted as replaced) or restated by the code-owned line.
    ["en", "Apply for your exam by 3 February 2027."],
    ["en", "Pay the fee for your exam before 3 February 2027."],
    ["en", "Your exam documents are due by 3 February 2027."],
    ["en", "Send the form for your exam no later than 3 February 2027."],
    ["de", "Den Antrag für Ihre Prüfung stellen Sie bis 3. Februar 2027."],
    ["de", "Bewerben Sie sich für Ihre Prüfung bis zum 3. Februar 2027."],
    ["de", "Zahlen Sie die Gebühr für Ihre Prüfung bis 3. Februar 2027."],
    ["de", "Für Ihre Prüfung gilt der 3. Februar 2027 als letzter Tag."],
    ["en", "Your exam is the last possible day to apply: 3 February 2027."],
    ["ru", "Ваш экзамен: подать заявление до 3 февраля 2027 года."],
    ["tr", "Sınavınız için belgeleri 3 Şubat 2027 tarihine kadar gönderin."],
    ["fr", "Votre examen: dossier à envoyer avant le 3 février 2027."],
    ["de", "Laut MedUni Wien ist Ihre Prüfung am 3. Februar 2027."],
    ["en", "According to MedUni Wien your exam is on 3 February 2027."],
    ["de", "Frist und Ihre Prüfung: 3. Februar 2027."],
    ["en", "Deadline and your exam date: 3 February 2027."],
    ["de", "Ihre Prüfung im Februar ist zugleich der Monat, in dem die SIP4a stattfindet."],
    ["de", "Ihre Prüfung ist schon lange geplant, und viele Kolleginnen und Kollegen sehen den 3. Februar 2027 als Termin."],
  ])("never shown in model wording (%s): %s", (lang, sentence) => {
    const v = uncited(lang, sentence);
    expect(all(v)).not.toContain(sentence);
    if (!v.replaced) expect(all(v)).toContain(ownExamDateLine(lang as MentorLang, "2027-02-03", 114));
    for (const b of v.blocks) expect(b.confirmed_dates).toBeUndefined();
  });

  it.each([
    // Not named as the learner's own: reads as an official date (gate6 review P2).
    ["de", "Die Frist endet am 3. Februar 2027."],
    ["de", "Die Prüfung findet am 3. Februar 2027 statt."],
    ["en", "The exam is on 3 February 2027."],
    // "ihre" lower case is her/their exam, not the learner's.
    ["de", "Laut Plan ist ihre Prüfung am 3. Februar 2027."],
    // Own marker, but not the profile date.
    ["de", "Ihr Prüfungsdatum ist der 5. Februar 2027."],
    ["en", "Your exam date is 3 March 2027."],
    ["de", "Ihre Prüfung ist im März."],
    // Own date and another, unsupported date in one sentence: the other date still fails.
    ["de", "Ihr Prüfungsdatum ist der 3. Februar 2027, die Anmeldung endet am 15. Dezember 2026."],
    // Review P1 probes: the profile date itself worded as a deadline, a registration or an official date.
    ["de", "Die Anmeldefrist für Ihre Prüfung endet am 3. Februar 2027."],
    ["en", "Registration for your exam closes on 3 February 2027."],
    ["fr", "Votre date limite d'inscription est le 3 février 2027."],
    ["de", "Ihr Termin: Anmeldeschluss 3. Februar 2027."],
    ["de", "Wie Sie angegeben haben, endet die Frist am 3. Februar 2027."],
    ["en", "Before you set your plan: the deadline is 3 February 2027."],
    ["ru", "Ваша дата подачи документов: 3 февраля 2027 года."],
    ["de", "Ihre Prüfung ist der Stichprobentest, der offizielle Termin ist am 3. Februar 2027."],
    ["en", "Your exam is the Stichprobentest; the official sitting is on 3 February 2027."],
    ["de", "Ihre Prüfung ist im Februar, die Anmeldung schließt im Februar."],
    ["de", "Ihre Prüfung ist im Februar und die Anmeldung schließt im Februar."],
    ["de", "Für Ihre Prüfung endet die Anmeldung am 3. Februar 2027."],
    ["en", "Your exam registration closes on 3 February 2027."],
    ["de", "Ihr Termin ist am 3. Februar 2027."],
    ["en", "Your date is 3 February 2027."],
  ])("deleted (%s): %s", (lang, sentence) => {
    const v = uncited(lang, sentence);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain(sentence);
  });

  // Gate9 P1 (reviewer rounds 3 and 4, un-skipped): a progress-cited block never shows the date in model wording.
  it.each([
    "Apply for your exam by 3 February 2027.",
    "Die Anmeldefrist endet am 3. Februar 2027.",
    "The official SIP4a sitting is on 3 February 2027.",
    "Ihr Prüfungsdatum ist der 3. Februar 2027.",
  ])("a progress-cited block never shows the date in model wording: %s", (sentence) => {
    const v = study(`@@LANG de\n@@BLOCK facts=${progress.id}\nAm schwächsten sind Sie in HNO mit 40 %. ${sentence}`);
    expect(all(v)).not.toContain(sentence);
    expect(all(v)).toContain("Am schwächsten sind Sie in HNO mit 40 %.");
    if (!v.replaced) expect(all(v)).toContain(ownExamDateLine("de", "2027-02-03", 114));
    for (const b of v.blocks) expect(b.confirmed_dates).toBeUndefined();
  });

  // Gate9 P1 (reviewer round 4, un-skipped).
  it.each([
    // Review P1 (round 4): the days left until the learner's own date are not a registration countdown.
    ["Die Anmeldefrist endet in 114 Tagen.", false],
    ["Registration for the SIP4a closes in 114 days.", false],
    ["In 114 Tagen findet die SIP4a statt.", false],
    ["Laut MedUni Wien bleiben 114 Tage.", false],
    ["Ihnen bleiben noch 114 Tage.", true],
    ["You have 114 days left to prepare.", true],
  ] as const)("days left in a progress-cited block: %s (kept: %s)", (sentence, kept) => {
    const v = study(`@@LANG de\n@@BLOCK facts=${progress.id}\nAm schwächsten sind Sie in HNO mit 40 %. ${sentence}`);
    expect(all(v).includes(sentence), JSON.stringify(v.rejected)).toBe(kept);
    expect(all(v)).toContain("Am schwächsten sind Sie in HNO mit 40 %.");
  });

  it("a days-left count equal to another progress number is still checked as a countdown", () => {
    const text = PROGRESS_TEXT.replace("noch 114 Tage", "noch 81 Tage");
    const p81 = fact({ ...progress, text_de: text, text_en: text });
    const v = validateAnswer(`@@LANG en\n@@BLOCK facts=${p81.id}\nYou answered 81 questions. Registration closes in 81 days.`, [p81], { study: true, retrievedIds: [p81.id], resolve: (id) => (id === p81.id ? p81 : null) });
    expect(all(v)).toContain("You answered 81 questions.");
    expect(all(v)).not.toContain("Registration closes in 81 days.");
  });

  it("an official registration status still lends its own days left", async () => {
    const b = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = await b.runTool("get_dates", { exam_key: "sip4a", filing_university: "wien" }, ctx({ now, lang: "de" }));
    const body = JSON.parse(r.content) as { sittings: Array<{ fact_id: string; deadline_template: { closing_line: string } }>; status_fact_id: string };
    const retrieved = [...r.factIds, progress.id];
    const facts = await L.byIds(r.factIds, now);
    const resolveAll = (id: string) => (id === progress.id ? progress : b.resolveFact?.(id) ?? null);
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${body.sittings[0].fact_id},${body.status_fact_id}\n${body.sittings[0].deadline_template.closing_line}`, facts, { retrievedIds: retrieved, resolve: resolveAll });
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
  });

  it("the line is shown once per answer, other values in the block stay", () => {
    const v = study(`@@LANG en\n@@BLOCK facts=${progress.id}\nHNO is at 40 %.\n@@BLOCK\nYour exam date is 3 February 2027. Practise HNO first.\n@@BLOCK\nYou entered 3 February 2027 yourself.`);
    const line = ownExamDateLine("en", "2027-02-03", 114);
    expect(v.replaced).toBe(false);
    expect(all(v).split(line).length - 1).toBe(1);
    expect(all(v)).toContain("HNO is at 40 %.");
    expect(all(v)).toContain("Practise HNO first.");
    expect(v.blocks).toHaveLength(2);
  });

  it("without the learner's progress in this turn nothing is grounded", () => {
    const v = study(`@@LANG de\n@@BLOCK\nIhr Prüfungsdatum ist der 3. Februar 2027.`, [], []);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("3. Februar 2027");
  });

  it("an official block may restate the own date only as the learner's own, never as confirmed", async () => {
    const b = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = await b.runTool("get_dates", { exam_key: "sip4a", filing_university: "wien" }, ctx({ now, lang: "de" }));
    const row = (JSON.parse(r.content).sittings as Array<{ fact_id: string }>)[0];
    const facts = await L.byIds([row.fact_id], now);
    const resolve = (id: string) => (id === progress.id ? progress : null);
    const keep = validateAnswer(`@@LANG de\n@@BLOCK facts=${row.fact_id}\nIhr eingetragenes Prüfungsdatum 3. Februar 2027 liegt nach diesem Termin.`, facts, { retrievedIds: [row.fact_id, progress.id], resolve });
    expect(keep.replaced, JSON.stringify(keep.rejected)).toBe(false);
    expect(keep.blocks[0].text).toBe(ownExamDateLine("de", "2027-02-03", 114));
    expect(keep.blocks[0].confirmed_dates ?? []).not.toContain("3. Februar 2027");
    for (const sentence of ["Apply for your exam by 3 February 2027.", "Bewerben Sie sich für Ihre Prüfung bis zum 3. Februar 2027.", "Ihre Prüfung am 3. Februar 2027 ist die SIP4a."]) {
      const w = validateAnswer(`@@LANG de\n@@BLOCK facts=${row.fact_id}\n${sentence}`, facts, { retrievedIds: [row.fact_id, progress.id], resolve });
      expect(w.blocks.map((x) => x.text).join("\n"), sentence).not.toContain(sentence);
    }
    for (const sentence of ["Die Sitzung ist am 3. Februar 2027.", "Für Ihre Prüfung endet die Anmeldung am 3. Februar 2027.", "Your exam registration closes on 3 February 2027."]) {
      const drop = validateAnswer(`@@LANG de\n@@BLOCK facts=${row.fact_id}\n${sentence}`, facts, { retrievedIds: [row.fact_id, progress.id], resolve });
      expect(drop.replaced, sentence).toBe(true);
    }
  });

  it("the exam choice from the profile is restated without any value", () => {
    const v = uncited("de", "Ihre gewählte Prüfung ist der Stichprobentest.");
    expect(v.replaced).toBe(false);
    expect(all(v)).toContain("Ihre gewählte Prüfung ist der Stichprobentest.");
  });
});

// ─── 2. "Rezeptierkunde (Pharmakologie) im Januar" (gate7 run 2 dl-rez-jan-de) ─

async function rezJan(rest: string, extra: string[] = ["rezeptierkunde.registration.method"]) {
  const b = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
  const r = await b.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien", month: "2027-01" }, ctx({ now, lang: "de" }));
  const body = JSON.parse(r.content) as { sittings: Array<{ fact_id: string; deadline_template: { closing_line: string; sitting_line: string } }>; status_fact_id: string };
  const row = body.sittings[0];
  const retrieved = [...r.factIds, ...extra];
  const head = `@@LANG de\n@@BLOCK facts=${row.fact_id},${body.status_fact_id}\n${row.deadline_template.closing_line}\n${row.deadline_template.sitting_line}\n`;
  return b.validate(head + rest, await L.byIds(retrieved, now), retrieved);
}

describe("a bracketed exam-name gloss before the restated sitting month (gate7 dl-rez-jan-de)", () => {
  it("dl-rez-jan-de recorded block: the sentence stays, no notice", async () => {
    const v = await rezJan("@@BLOCK facts=rezeptierkunde.registration.method\nJa, die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) im Januar an. Das Anmeldefenster ist noch nicht offen. Die Anmeldung erfolgt ausschließlich per Anmeldeformular (Scan oder Foto) über den muw-Account an nostrifikationspruefungsanmeldungen@meduniwien.ac.at. Eine nachträgliche Anmeldung ist aus gesetzlichen Gründen nicht möglich.");
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain("Ja, die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) im Januar an.");
    expect(all(v)).not.toMatch(NOT_CONFIRMED);
  });

  it("gate8 run 1 dl-rez-jan-de recorded block: 'auch im Januar 2027' stays, no notice", async () => {
    const v = await rezJan("@@BLOCK facts=rezeptierkunde.registration.method\nJa, die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) auch im Januar 2027 an. Die Anmeldung erfolgt ausschließlich per E-Mail mit dem Anmeldeformular über Ihren muw-Account. Das Anmeldefenster ist noch nicht offen. Eine nachträgliche Anmeldung ist aus gesetzlichen Gründen nicht möglich.");
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain("Ja, die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) auch im Januar 2027 an.");
    expect(all(v)).not.toMatch(NOT_CONFIRMED);
  });

  it.each([
    "Die Pharmakologie (Rezeptierkunde) im Januar findet in Wien statt.",
    "The Rezeptierkunde sitting also in January 2027 is at MedUni Wien.",
    "Die Rezeptierkunde (Pharmakologie) Prüfung im Januar 2027 ist bei der MedUni Wien.",
  ])("kept: %s", async (sentence) => {
    const v = await rezJan(`@@BLOCK facts=rezeptierkunde.registration.method\n${sentence} Die Anmeldung erfolgt per Anmeldeformular.`);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain(sentence);
  });

  it.each([
    // Another month than the cited row's.
    "Die Rezeptierkunde (Pharmakologie) im März findet in Wien statt.",
    // A non-exam word in the bracket.
    "Die Rezeptierkunde (Anmeldung) im Januar findet in Wien statt.",
    // A digit in the bracket.
    "Die Rezeptierkunde (2027) im Januar findet in Wien statt.",
    // Another exam named in the sentence.
    "Die Rezeptierkunde (SIP4a) im Januar findet in Wien statt.",
    // A bracket that glosses no part of this exam (review P3).
    "Die Rezeptierkunde (SIP) im Januar findet in Wien statt.",
    // An exclusive adverb is a claim, and an additive one never lends another month.
    "Die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) nur im Januar an.",
    "Die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) auch im März an.",
    // A deadline word in the sentence.
    "Melden Sie sich für die Rezeptierkunde (Pharmakologie) im Januar bis Dezember an.",
    // Not adjacent: the month is not the sitting's.
    "Die Rezeptierkunde (Pharmakologie) öffnet die Anmeldung im Januar.",
  ])("deleted: %s", async (sentence) => {
    const v = await rezJan(`@@BLOCK facts=rezeptierkunde.registration.method\n${sentence} Die Anmeldung erfolgt per Anmeldeformular.`);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain(sentence);
  });

  it("without a cited Rezeptierkunde sitting row the month is not grounded", async () => {
    const facts = await L.byIds(["rezeptierkunde.registration.method"], now);
    const v = validateAnswer("@@LANG de\n@@BLOCK facts=rezeptierkunde.registration.method\nJa, die MedUni Wien bietet die Rezeptierkunde (Pharmakologie) im Januar an.", facts);
    expect(v.replaced).toBe(true);
  });
});
