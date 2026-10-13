/**
 * Live trust gate round 8 (a-mentor-gate8), track-A rule decisions of 13 Oct:
 * - the learner's own exam date from their profile row may be restated in a
 *   sentence that names it as their own entry (grounded on the profile row,
 *   never deleted, never a confirmed date);
 * - "die Rezeptierkunde (Pharmakologie) im Januar" is grounded on the cited
 *   sitting row of the same exam and month, a bracketed exam-name gloss included.
 * Every positive case has a negative twin that must still be deleted.
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { validateAnswer } from "@/lib/mentor/validator";
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
  it("st-spt-de recorded answer: the own-entry sentence stays, no notice, no confirmed date", () => {
    const raw = `@@LANG de\n@@BLOCK facts=${progress.id}\nAm schwächsten sind Sie in Gynäkologie mit 36 % richtigen Antworten (14 beantwortet) und in HNO mit 40 % (10 beantwortet). Ihr Gesamtergebnis liegt bei 57 % richtig aus 81 beantwortbaren Fragen. Ihr selbst eingetragenes Prüfungsdatum ist der 3. Februar 2027, also noch 114 Tage.\n@@BLOCK facts=${progress.id}\nZuerst sollten Sie Gynäkologie und HNO gezielt üben, da hier die Trefferquote am niedrigsten ist. Danach wiederholen Sie diese Themen in kurzen Einheiten, um die Fehlerquellen zu erkennen. Zum Schluss festigen Sie Ihre Stärken Pädiatrie (79 %) und Notfallmedizin (60 %) mit gemischten Übungsfragen, damit das Wissen über alle Bereiche stabil bleibt.\n@@BLOCK\nDas Datum 3. Februar 2027 ist Ihr eigener Eintrag und keine offizielle Termin- oder Fristangabe.`;
    const v = study(raw);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain("Das Datum 3. Februar 2027 ist Ihr eigener Eintrag und keine offizielle Termin- oder Fristangabe.");
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
    ["en", "The date you entered, February 3, 2027, is your own entry."],
    ["fr", "Votre date d'examen est le 3 février 2027."],
    ["ru", "Ваша дата экзамена: 3 февраля 2027 года."],
    ["uk", "Ваша дата іспиту: 3 лютого 2027 року."],
    ["tr", "Sınav tarihiniz 3 Şubat 2027."],
  ])("kept (%s): %s", (lang, sentence) => {
    const v = uncited(lang, sentence);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain(sentence);
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
  ])("deleted (%s): %s", (lang, sentence) => {
    const v = uncited(lang, sentence);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain(sentence);
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
    const keep = validateAnswer(`@@LANG de\n@@BLOCK facts=${row.fact_id}\nIhr eingetragenes Prüfungsdatum 3. Februar 2027 liegt nach dieser Sitzung.`, facts, { retrievedIds: [row.fact_id, progress.id], resolve });
    expect(keep.replaced, JSON.stringify(keep.rejected)).toBe(false);
    expect(keep.blocks[0].confirmed_dates ?? []).not.toContain("3. Februar 2027");
    const drop = validateAnswer(`@@LANG de\n@@BLOCK facts=${row.fact_id}\nDie Sitzung ist am 3. Februar 2027.`, facts, { retrievedIds: [row.fact_id, progress.id], resolve });
    expect(drop.replaced).toBe(true);
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

  it.each([
    "Die Pharmakologie (Rezeptierkunde) im Januar findet in Wien statt.",
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
