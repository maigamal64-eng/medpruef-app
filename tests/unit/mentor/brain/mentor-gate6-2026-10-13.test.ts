/**
 * Live trust gate round 6 (a-mentor-gate6): the three replacements of the gate5
 * run. A restated month of a cited sitting row is grounded on that row (same exam
 * only), a confirmed deadline is never followed by a not-confirmed notice for the
 * same exam, and a study block's count of its own topics is dropped.
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { dropStudyCountWords, validateAnswer } from "@/lib/mentor/validator";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { ctx, fact, fakeDb } from "./helpers";

const L = getMentorFactsLoader();
const now = new Date("2026-10-12T08:00:00Z");
const brain = () => createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;
const all = (v: ValidatedAnswer) => v.blocks.map((b) => b.text).join("\n\n");
const NOT_CONFIRMED = /nicht offiziell bestätigen|nicht offiziell bestätigt|can't officially confirm|not officially confirmed/;

type Row = { fact_id: string; deadline_template: { closing_line: string; sitting_line: string } };

async function dates(exam: string, month?: string) {
  const b = brain();
  const r = await b.runTool("get_dates", { exam_key: exam, filing_university: "wien", ...(month ? { month } : {}) }, ctx({ now, lang: "de" }));
  const body = parse(r.content);
  const row = (body.sittings as Row[])[0];
  return { b, r, row, statusId: body.status_fact_id as string };
}

async function run(exam: string, month: string | undefined, rest: (row: Row) => string, extraIds: string[] = []) {
  const { b, r, row, statusId } = await dates(exam, month);
  const head = `@@LANG de\n@@BLOCK facts=${row.fact_id},${statusId}\n${row.deadline_template.closing_line}\n${row.deadline_template.sitting_line}\n`;
  const retrieved = [...r.factIds, ...extraIds];
  return b.validate(head + rest(row), await L.byIds(retrieved, now), retrieved);
}

describe("a restated month of a cited sitting row is grounded on it (gate5 dl-sip4a-still-open-de, dl-rez-jan-de)", () => {
  it("dl-sip4a-still-open-de: 'im November' in the method block stays, no notice", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nJa, die Anmeldefenster für die SIP4a im November bei der MedUni Wien ist offen. Das Formular füllen Sie elektronisch aus (nicht ausdrucken) und senden es während der Anmeldefrist an nostrifikationspruefungsanmeldungen@meduniwien.ac.at.\n@@BLOCK facts=sip4a.registration.no-late-registration\nNachmeldungen sind laut Prüfungskalender aus keinem Grund möglich, die Anmeldefrist kann nicht überschritten werden.",
      ["sip4a.registration.method", "sip4a.registration.no-late-registration"]);
    expect(v.replaced).toBe(false);
    expect(v.rejected).toEqual([]);
    expect(all(v)).toContain("im November bei der MedUni Wien ist offen");
    expect(all(v)).not.toMatch(NOT_CONFIRMED);
  });

  it("dl-rez-jan-de: 'im Januar 2027' in the method block stays, no notice", async () => {
    const v = await run("rezeptierkunde", "2027-01", () =>
      "@@BLOCK facts=rezeptierkunde.registration.method\nJa, die MedUni Wien bietet die Rezeptierkunde im Januar 2027 an. Das Anmeldefenster ist noch nicht offen. Eine nachträgliche Anmeldung ist aus gesetzlichen Gründen nicht möglich.",
      ["rezeptierkunde.registration.method"]);
    expect(v.replaced).toBe(false);
    expect(all(v)).toContain("im Januar 2027 an");
    expect(all(v)).not.toMatch(NOT_CONFIRMED);
  });

  it("a month that is not the cited row's month is still deleted", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nJa, die Anmeldung für die SIP4a im März ist offen. Das Formular füllen Sie elektronisch aus.",
      ["sip4a.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("im März");
    expect(all(v)).toContain("Das Formular füllen Sie elektronisch aus.");
  });

  it("a day date restated in the method block is still checked (only month and year are borrowed)", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nSenden Sie das Formular bis 19. Oktober 2026. Das Formular füllen Sie elektronisch aus.",
      ["sip4a.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(v.rejected.map((r) => r.value)).toContain("19. Oktober 2026");
  });

  it("another exam's sitting month is never borrowed", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=rezeptierkunde.registration.method\nDie Rezeptierkunde findet im November statt. Die Anmeldung erfolgt per Anmeldeformular.",
      ["rezeptierkunde.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("im November statt");
    // No confirmed Rezeptierkunde deadline is shown, so its notice stays.
    expect(all(v)).toMatch(/Rezeptierkunde kann ich gerade nicht offiziell bestätigen/);
  });

  it("without a cited sitting row the month is not grounded", async () => {
    const b = brain();
    const ids = ["sip4a.registration.method"];
    const v = b.validate("@@LANG de\n@@BLOCK facts=sip4a.registration.method\nJa, die Anmeldung für die SIP4a im November ist offen.", await L.byIds(ids, now), ids);
    expect(v.replaced).toBe(true);
    expect(all(v)).toMatch(NOT_CONFIRMED);
  });
});

describe("a confirmed deadline is never contradicted by a not-confirmed notice of the same exam", () => {
  it("a deleted wrong month keeps the deadline and adds no SIP4a registration notice", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nDie Anmeldung im März ist auch möglich.\n@@BLOCK facts=sip4a.registration.no-late-registration\nNachmeldungen sind aus keinem Grund möglich.",
      ["sip4a.registration.method", "sip4a.registration.no-late-registration"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).toContain("19. Oktober 2026");
    expect(all(v)).not.toMatch(NOT_CONFIRMED);
  });

  it("a notice of another topic for the same exam stays (attempts are not the deadline)", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.attempts.limit\nDie SIP4a kann 17 Mal wiederholt werden.",
      ["sip4a.attempts.limit"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).toContain("19. Oktober 2026");
    expect(all(v)).toMatch(NOT_CONFIRMED);
  });

  it("a deleted fee in a registration block keeps a generic notice, never the deadline wording", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nDas Formular füllen Sie elektronisch aus; die Gebühr beträgt 999 EUR.",
      ["sip4a.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("999");
    expect(all(v)).not.toMatch(/Anmeldeschluss für SIP4a kann ich/);
    expect(all(v)).toContain("Diese Angabe ist nicht offiziell bestätigt.");
  });

  it("validateAnswer without a deadline block keeps the registration notice", () => {
    const method = fact({ id: "sip4a.registration.method", exam_key: "sip4a", topic: "registration", text_de: "Die Anmeldung erfolgt per E-Mail.", text_en: "Registration is by email." });
    const v = validateAnswer("@@LANG de\n@@BLOCK facts=sip4a.registration.method\nDie Anmeldung erfolgt per E-Mail bis 3. März.", [method]);
    expect(v.replaced).toBe(true);
    expect(all(v)).toMatch(NOT_CONFIRMED);
  });
});

describe("study blocks drop a count of their own topics (gate5 st-spt-en)", () => {
  it("dropStudyCountWords", () => {
    expect(dropStudyCountWords("Then, do the same for HNO, and keep the two topics in regular rotation.")).toBe("Then, do the same for HNO, and keep the topics in regular rotation.");
    expect(dropStudyCountWords("Ihre drei schwächsten Bereiche sind HNO, Gynäkologie und Pädiatrie.")).toBe("Ihre schwächsten Bereiche sind HNO, Gynäkologie und Pädiatrie.");
    expect(dropStudyCountWords("die Fehler in diesen drei Bereichen nacharbeiten")).toBe("die Fehler in diesen Bereichen nacharbeiten");
    expect(dropStudyCountWords("your 2 weakest topics")).toBe("your weakest topics");
    // Never a time, dose or question count.
    expect(dropStudyCountWords("the two hours, the three questions, alle acht Stunden, die zwei Tabletten")).toBe("the two hours, the three questions, alle acht Stunden, die zwei Tabletten");
  });

  const progress = fact({
    id: "progress.00000000-0000-4000-9000-000000000084",
    exam_key: "general",
    topic: "results",
    text_de: "Gynäkologie 36 % bei 14 Antworten; HNO 40 % bei 10 Antworten; gesamt 57 % bei 81 Antworten; 114 Tage.",
    text_en: "Gynäkologie 36 percent on 14 answered; HNO 40 percent on 10 answered; overall 57 percent on 81 answered; 114 days.",
  });

  it("st-spt-en: the plan sentence survives in a progress block", () => {
    const raw = `@@LANG en\n@@BLOCK facts=${progress.id}\nFirst, work through the Gynäkologie questions in short sets. Then, do the same for HNO, and keep the two topics in regular rotation.`;
    const v = validateAnswer(raw, [progress], { study: true, retrievedIds: [progress.id], resolve: (id) => (id === progress.id ? progress : null) });
    expect(v.replaced).toBe(false);
    expect(all(v)).toContain("keep the topics in regular rotation");
  });

  it("the same count outside a study block is still checked", () => {
    const method = fact({ id: "sip4a.registration.method", exam_key: "sip4a", topic: "registration", text_de: "Die Anmeldung erfolgt per E-Mail.", text_en: "Registration is by email." });
    const v = validateAnswer("@@LANG en\n@@BLOCK facts=sip4a.registration.method\nRegistration covers the two topics of the exam.", [method]);
    expect(v.replaced).toBe(true);
  });

  it("a wrong progress number in a study block is still deleted", () => {
    const raw = `@@LANG en\n@@BLOCK facts=${progress.id}\nHNO is at 40 percent. Gynäkologie is at 99 percent.`;
    const v = validateAnswer(raw, [progress], { study: true, retrievedIds: [progress.id], resolve: (id) => (id === progress.id ? progress : null) });
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("99 percent");
  });
});
