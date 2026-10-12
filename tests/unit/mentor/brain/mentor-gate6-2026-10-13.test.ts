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

  it("a borrowed month inside a deadline phrase is still deleted (review P1: 'bis Ende November')", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nDie Anmeldung ist bis Ende November möglich. Das Formular füllen Sie elektronisch aus.",
      ["sip4a.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("Ende November");
  });

  it("only the sitting's own month is borrowed, never its registration-close month", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nJa, die Anmeldung im Oktober ist offen. Das Formular füllen Sie elektronisch aus.",
      ["sip4a.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("im Oktober");
  });

  for (const sentence of [
    "Melden Sie sich im November an.",
    "Die Anmeldung öffnet im November.",
    "Die Anmeldung läuft im November.",
    "Das Anmeldefenster beginnt im November.",
    "Die Unterlagen müssen im November vorliegen.",
    "Die Ergebnisse erhalten Sie im November.",
    "Registration opens in November.",
    "Apply in November using the form.",
    "The registration window shuts in November.",
  ]) {
    it(`a borrowed month that does not name the sitting is deleted: ${sentence}`, async () => {
      const v = await run("sip4a", undefined, () => `@@BLOCK facts=sip4a.registration.method\n${sentence} Das Formular füllen Sie elektronisch aus.`, ["sip4a.registration.method"]);
      expect(v.replaced).toBe(true);
      expect(all(v)).not.toContain(sentence);
    });
  }

  for (const sentence of ["Ja, die Anmeldung für die SIP4a im November ist offen.", "Yes, registration for the November sitting is open.", "Ja, die Prüfung im November findet statt."]) {
    it(`a month naming the sitting stays: ${sentence}`, async () => {
      const v = await run("sip4a", undefined, () => `@@BLOCK facts=sip4a.registration.method\n${sentence}`, ["sip4a.registration.method"]);
      expect(v.replaced).toBe(false);
      expect(all(v)).toContain(sentence);
    });
  }

  for (const sentence of ["Der Stichprobentest im November findet ebenfalls an der MedUni Wien statt.", "Die Gerichtsmedizin-Prüfung im November ist ebenfalls offen."]) {
    it(`a borrowed month is refused in a sentence naming another exam: ${sentence}`, async () => {
      const v = await run("sip4a", undefined, () => `@@BLOCK facts=sip4a.registration.method\n${sentence}`, ["sip4a.registration.method"]);
      expect(v.replaced).toBe(true);
      expect(all(v)).not.toContain(sentence);
    });
  }

  it("a bare year is never borrowed (review P2)", async () => {
    const v = await run("sip4a", undefined, () =>
      "@@BLOCK facts=sip4a.registration.method\nSeit 2026 ist die Anmeldung nur noch elektronisch möglich.",
      ["sip4a.registration.method"]);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("Seit 2026");
  });

  it("another university's sitting month is never borrowed for a Wien filer (review P1)", async () => {
    const b = brain();
    const r = await b.runTool("get_dates", { exam_key: "stichprobentest", filing_university: "innsbruck", month: "2027-02" }, ctx({ now, lang: "de" }));
    const row = (parse(r.content).sittings as Row[])[0];
    expect(row.fact_id).toContain(".innsbruck.");
    const ids = [...r.factIds, "stichprobentest.registration.filing-university"];
    const raw = `@@LANG de\n@@BLOCK facts=${row.fact_id}\n${row.deadline_template.closing_line}\n@@BLOCK facts=stichprobentest.registration.filing-university\nWenn Sie in Wien eingereicht haben, gilt für Sie der Termin im Februar 2027.`;
    const v = b.validate(raw, await L.byIds(ids, now), ids);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("Wenn Sie in Wien eingereicht haben");
    // Control: the same month with no other university named stays.
    const ok = b.validate(raw.replace("Wenn Sie in Wien eingereicht haben, gilt für Sie der Termin im Februar 2027.", "Ja, die Prüfung im Februar 2027 findet in Innsbruck statt."), await L.byIds(ids, now), ids);
    expect(all(ok)).toContain("im Februar 2027");
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

  it("a block with only the sitting date is not a confirmed deadline: the notice stays (re-review P2)", async () => {
    const { b, r, row } = await dates("sip4a");
    const ids = [...r.factIds, "sip4a.registration.method"];
    const raw = `@@LANG de\n@@BLOCK facts=${row.fact_id}\n${row.deadline_template.sitting_line}\n@@BLOCK facts=sip4a.registration.method\nAnmeldeschluss ist der 30. Oktober 2026.`;
    const v = b.validate(raw, await L.byIds(ids, now), ids);
    expect(v.replaced).toBe(true);
    expect(all(v)).not.toContain("30. Oktober");
    expect(all(v)).toMatch(NOT_CONFIRMED);
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
    expect(dropStudyCountWords("Die drei schwächsten Bereiche sind HNO, Gynäkologie und Pädiatrie.")).toBe("Die schwächsten Bereiche sind HNO, Gynäkologie und Pädiatrie.");
    expect(dropStudyCountWords("die Fehler der drei Themenbereiche")).toBe("die Fehler der Themenbereiche");
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

describe("gate6 run 1 residuals", () => {
  it("pr-rez-format-de: '1 Stunde' is the fact's 'eine Stunde'", async () => {
    const ids = ["rezeptierkunde.format.wien-rules"];
    const raw = "@@LANG de\n@@BLOCK facts=rezeptierkunde.format.wien-rules\nDie Gesamtprüfungsdauer beträgt 1 Stunde: 45 Minuten für die Beantwortung und 15 Minuten für das Übertragen der Antworten auf den Antwortbogen.";
    const v = brain().validate(raw, await L.byIds(ids, now), ids);
    expect(v.replaced).toBe(false);
    expect(all(v)).toContain("1 Stunde");
  });

  for (const [id, sentence] of [
    ["rezeptierkunde.format.wien-rules", "Sie haben nur 1 Antritt."],
    ["rezeptierkunde.format.wien-rules", "Nach 1 Woche erhalten Sie das Ergebnis."],
    ["general.documents.chamber-confirmation", "Die Bestätigung ist 1 Monat gültig."],
  ] as const) {
    it(`a 1 with another unit than the fact's 'eine <unit>' is still rejected: ${sentence}`, async () => {
      const v = brain().validate(`@@LANG de\n@@BLOCK facts=${id}\n${sentence}`, await L.byIds([id], now), [id]);
      expect(v.replaced).toBe(true);
      expect(all(v)).not.toContain(sentence);
    });
  }

  it("a bare 1 is still rejected when the cited fact has no 'one <unit>' phrase", () => {
    const f = fact({ id: "fixture.format.sip5a", text_de: "Die Prüfung hat 123 Fragen.", text_en: "The exam has 123 questions." });
    const v = validateAnswer("@@LANG de\n@@BLOCK facts=fixture.format.sip5a\nDie Prüfung dauert 1 Stunde.", [f]);
    expect(v.replaced).toBe(true);
  });

  it("r3-explain-gloss-8-tr: German prose with two Turkish words is a mismatch (retry fires)", async () => {
    const { answerLanguageMismatch } = await import("@/lib/mentor/answer-language");
    const raw = "@@LANG tr\n@@BLOCK layer=grounded facts=question.9000008\nPhytomenadion (K vitamini) hebt die Wirkung von Phenprocoumon (fenprokumon) auf, weil es die Gerinnungsfaktorsynthese wiederherstellt. Die Seçenek Protamin (protamin) ist ein Heparin-Antidot und wirkt hier nicht, weil Phenprocoumon kein Heparin ist. Der Schlüssel ist nach dem vorliegenden Erklärungstext plausibel.\n\n@@BLOCK layer=grounded facts=question.9000008\nPhenprocoumon ist ein Vitamin-K-Antagonist und hemmt die Synthese der Gerinnungsfaktoren. Vitamin K wirkt deshalb an der Ursache, allerdings mit Verzögerung von Stunden.\n\n@@BLOCK layer=grounded facts=question.9000008\nTrick: Phenprocoumon hemmt die Vitamin-K-abhängige Synthese, deshalb hebt das Vitamin selbst die Wirkung auf. Die übrigen Seçenekler wirken über andere Mechanismen und sind hier nicht passend.";
    expect(answerLanguageMismatch(raw, "tr")).toBe("de");
    // A Turkish answer that quotes German terms is not a mismatch.
    expect(answerLanguageMismatch("@@LANG tr\nDoğru cevap Protamin (protamin), çünkü Heparin (heparin) ile bağlanır ve bu yüzden etkisini nötralize eder. Diğer seçenekler bu soru için uygun değil.", "tr")).toBeNull();
  });
});
