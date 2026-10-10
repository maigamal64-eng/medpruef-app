/**
 * Mentor quality loop, round 2 (run1-r1 failure causes). One test group per
 * fixed cause. Synthetic facts use 2099 dates and odd amounts; the last group
 * replays real run1 answers against the real fact files to pin the fix.
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { narrowToMonth, SCOPE_NOTE } from "@/lib/mentor/tools/run";
import { MENTOR_TOOLS } from "@/lib/mentor/tools/definitions";
import { getMentorFactsLoader, MentorFactsLoader, SHEET_PINNED_IDS, sittingFactId } from "@/lib/mentor/facts-loader";
import { askedMonths, removeSentences, extractValues, stripUnsupportedStand, trimUnaskedValues, validateAnswer } from "@/lib/mentor/validator";
import { learnerQuestion } from "@/lib/mentor/turn";
import type { OfficialSitting } from "@/lib/exam-dates";
import type { MentorFact, MentorTurnInput, ValidatedAnswer } from "@/lib/mentor/seam";
import { ctx, fact, fakeDb, makeLoader, NOW } from "./helpers";

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

const APP_PLANS = fact({
  id: "app.billing.plans",
  exam_key: "general",
  topic: "fee",
  read_on: "2099-01-02",
  text_de: "MedPrüf Pro kostet 23 EUR im Monat.",
  text_en: "MedPrüf Pro costs 23 EUR a month.",
});
const OFFICIAL = fact({ id: "fixture.format.official", read_on: "2099-01-01", text_de: "Die Prüfung hat 123 Fragen.", text_en: "The exam has 123 questions." });
const STEPS = fact({
  id: "fixture.glossary.steps",
  exam_key: "general",
  topic: "glossary",
  text_de: "Ablauf: Antrag, Ermittlungsverfahren, Nostrifizierungsbescheid.",
  text_en: "Procedure: application, Ermittlungsverfahren, Nostrifizierungsbescheid.",
});
const FEE = fact({ id: "fixture.fee.taxe", exam_key: "general", topic: "fee", text_de: "Die Taxe beträgt 777 Euro.", text_en: "The fee is 777 euros." });
const STRUCTURE = fact({ id: "fixture.format.structure", exam_key: "stichprobentest", topic: "format", text_de: "Der Test hat 321 Fragen.", text_en: "The test has 321 questions." });
const PASS = fact({ id: "fixture.pass.field", exam_key: "stichprobentest", topic: "pass_rule", text_de: "Ein Fach gilt ab 63 Prozent als bestanden.", text_en: "A field counts as passed from 63 percent." });
const ONCE = fact({ id: "fixture.attempts.once", exam_key: "stichprobentest", topic: "attempts", text_de: "Der Test kann nur einmal abgelegt werden.", text_en: "The test can be taken only once." });

function answer(blocks: Array<{ text: string; fact_ids: string[] }>, extra: Partial<ValidatedAnswer> = {}): ValidatedAnswer {
  const ids = [...new Set(blocks.flatMap((b) => b.fact_ids))];
  return {
    blocks,
    citations: ids.map((id) => ({ fact_id: id, source_label: "Fixture", source_url: "https://example.org/x", read_on: "2099-01-01" })),
    replaced: false,
    rejected: [],
    ...extra,
  };
}
function resolver(facts: MentorFact[]): (id: string) => MentorFact | null {
  const m = new Map(facts.map((f) => [f.id, f]));
  return (id) => m.get(id) ?? null;
}

describe("validator: an app fact's read-on date is not a value (ap-mentor-price-de)", () => {
  it("rejects the app fact's read_on but still allows an official fact's", () => {
    const app = validateAnswer("@@LANG de\n@@BLOCK facts=app.billing.plans\nPro kostet 23 EUR, Datum 2099-01-02 laut App.", [APP_PLANS]);
    expect(app.rejected.map((r) => r.value)).toContain("2099-01-02");
    const off = validateAnswer("@@LANG de\n@@BLOCK facts=fixture.format.official\nDie Prüfung hat 123 Fragen, Datum 2099-01-01.", [OFFICIAL]);
    expect(off.rejected).toEqual([]);
  });

  it("drops only the Stand note of an app fact and keeps the sentence", () => {
    const v = validateAnswer(
      "@@LANG de\n@@BLOCK facts=app.billing.plans\nDie Tarife stehen in der App (Stand der App-Angaben: 2099-01-02).\n@@BLOCK\nFür Fragen schreib uns.",
      [APP_PLANS]
    );
    expect(v.blocks[0].text).toBe("Die Tarife stehen in der App.");
    expect(v.replaced).toBe(false);
    expect(JSON.stringify(v.blocks)).not.toContain("2099-01-02");
  });

  it("keeps a supported Stand note and strips an unsupported tail note", () => {
    const allowed = new Set(["d:2099-01-01"]);
    expect(stripUnsupportedStand("Die Frist ist bekannt (Stand 2099-01-01).", allowed)).toBe("Die Frist ist bekannt (Stand 2099-01-01).");
    expect(stripUnsupportedStand("Pro kostet 23 EUR, Stand 2099-07-07.", allowed)).toBe("Pro kostet 23 EUR.");
  });

  it("safety holds: an invented date in the claim itself is still replaced", () => {
    const v = validateAnswer("@@LANG de\n@@BLOCK facts=app.billing.plans\nPro startet am 2099-09-09.", [APP_PLANS]);
    expect(v.replaced).toBe(true);
    expect(JSON.stringify(v.blocks)).not.toContain("2099-09-09");
  });
});

describe("validator: a status-only block shows its official sitting rows (uncited_block)", () => {
  it("adds the sitting row whose dates the block states, and replaces invented dates as before", async () => {
    const brain = createMentorBrain({ facts: makeLoader(), db: () => fakeDb({}).db, clock: () => NOW });
    const r = await brain.runTool("get_dates", { exam_key: "sip5a", filing_university: "all" }, ctx());
    const statusId = parse(r.content).status_fact_id as string;
    expect(statusId).toMatch(/^status\./);
    const sitId = (parse(r.content).sittings as Array<{ fact_id: string }>)[0].fact_id;
    const v = brain.validate(`@@LANG de\n@@BLOCK facts=${statusId}\nDie Anmeldung ist noch nicht offen, ab 2099-02-01, bis 2099-03-18.`, []);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].fact_ids).toEqual([sitId]);
    expect(v.citations.map((c) => c.fact_id)).toEqual([sitId]);
    const bad = brain.validate(`@@LANG de\n@@BLOCK facts=${statusId}\nDie Anmeldung endet am 2099-03-30.`, []);
    expect(bad.replaced).toBe(true);
    expect(bad.blocks[0].fact_ids).toEqual([]);
  });
});

const TWO_STP: OfficialSitting[] = [
  {
    exam_key: "stichprobentest",
    learner_label: { de: "Stichprobentest Feb", en: "Stichprobentest Feb" },
    date: "2099-02-03",
    registration_opens: null,
    registration_closes: "2098-12-14",
    deadline_type: "filing_cutoff",
    publisher: "Fixture Uni Wien",
    filing_university: "wien",
    source_url: "https://example.org/merkblatt",
    read_on: "2099-01-01",
  },
  {
    exam_key: "stichprobentest",
    learner_label: { de: "Stichprobentest Mai", en: "Stichprobentest May" },
    date: "2099-05-06",
    registration_opens: null,
    registration_closes: "2099-03-17",
    deadline_type: "filing_cutoff",
    publisher: "Fixture Uni Wien",
    filing_university: "wien",
    source_url: "https://example.org/merkblatt",
    read_on: "2099-01-01",
  },
];
const SUMMARY = fact({
  id: "fixture.dates.all-sittings",
  exam_key: "stichprobentest",
  topic: "dates",
  filing_university: "all",
  text_de: "Termine: 3. Februar 2099 und 6. Mai 2099.",
  text_en: "Sittings: 3 February 2099 and 6 May 2099.",
});
const MAY_ONLY = fact({
  id: "fixture.dates.2099-05-06.both",
  exam_key: "stichprobentest",
  topic: "dates",
  filing_university: "all",
  text_de: "Für den 6. Mai 2099 endet die Einreichfrist am 17. März 2099.",
  text_en: "For 6 May 2099 the filing cutoff is 17 March 2099.",
});
const RULE = fact({ id: "fixture.registration.rule", exam_key: "stichprobentest", topic: "registration", text_de: "Die Einladung kommt per E-Mail.", text_en: "The invitation comes by email." });

describe("get_dates: month narrows to the asked sitting (dl-stp-may-en)", () => {
  const brain = () =>
    createMentorBrain({ facts: makeLoader([SUMMARY, MAY_ONLY, RULE], TWO_STP), db: () => fakeDb({}).db, clock: () => NOW });

  it("returns only that month's sitting and drops facts naming another sitting", async () => {
    const r = parse((await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien", month: "2099-05" }, ctx())).content);
    expect((r.sittings as Array<{ date: string }>).map((s) => s.date)).toEqual(["2099-05-06"]);
    const ids = (r.facts as Array<{ fact_id: string }>).map((f) => f.fact_id);
    expect(ids).toContain(MAY_ONLY.id);
    expect(ids).not.toContain(SUMMARY.id);
    expect(r.scope).toBe(SCOPE_NOTE);
  });

  it("without month nothing is narrowed; a month with no sitting adds a note and keeps all rows", async () => {
    const all = parse((await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien" }, ctx())).content);
    expect((all.sittings as unknown[]).length).toBe(2);
    const none = parse((await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien", month: "2099-07" }, ctx())).content);
    expect((none.sittings as unknown[]).length).toBe(2);
    expect(String(none.month_note)).toMatch(/No upcoming sitting/);
  });

  it("rejects a malformed month and declares month as optional in the schema", async () => {
    const r = await brain().runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien", month: "Mai" }, ctx());
    expect(r.isError).toBe(true);
    const def = MENTOR_TOOLS.find((t) => t.name === "get_dates");
    const schema = def?.input_schema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toContain("month");
    expect(schema.required).not.toContain("month");
  });

  it("narrowToMonth is a no-op without a month", () => {
    const r = makeLoader([SUMMARY], TWO_STP).datesAt("stichprobentest", "wien", NOW);
    expect(narrowToMonth(r, undefined)).toBe(r);
  });
});

describe("trim: no unasked official fee (pr-steps-de, pr-steps-en)", () => {
  const blocks = [
    { text: "Zuerst kommt der Antrag. Die Taxe beträgt 777 Euro.\nDann folgt das Ermittlungsverfahren.", fact_ids: [STEPS.id, FEE.id] },
  ];
  const resolve = resolver([STEPS, FEE, APP_PLANS]);

  it("removes the fee sentence of a steps answer and the fee citation", () => {
    const out = trimUnaskedValues(answer(blocks), { question: "Wie läuft die Nostrifizierung Schritt für Schritt ab?", lang: "de", resolve, retrievedIds: [] });
    expect(out.blocks[0].text).toBe("Zuerst kommt der Antrag.\nDann folgt das Ermittlungsverfahren.");
    expect(out.blocks[0].fact_ids).toEqual([STEPS.id]);
    expect(out.citations.map((c) => c.fact_id)).toEqual([STEPS.id]);
  });

  it("keeps the fee when the learner asked about money", () => {
    for (const question of ["Was kostet die Nostrifizierung?", "How much is the fee?", "Muss ich etwas bezahlen?"]) {
      const v = answer(blocks);
      expect(trimUnaskedValues(v, { question, lang: "de", resolve, retrievedIds: [] })).toBe(v);
    }
  });

  it("never touches app prices (internal facts), refusals or other languages", () => {
    const app = answer([{ text: "Danach kostet Pro 23 EUR.", fact_ids: [] }]);
    expect(trimUnaskedValues(app, { question: "Was passiert nach der Testwoche?", lang: "de", resolve, retrievedIds: [] })).toBe(app);
    const refused = answer(blocks, { refused: "no_verified_source" });
    expect(trimUnaskedValues(refused, { question: "Ablauf?", lang: "de", resolve, retrievedIds: [] })).toBe(refused);
    const fr = answer(blocks);
    expect(trimUnaskedValues(fr, { question: "Quelles sont les étapes ?", lang: "fr", resolve, retrievedIds: [] })).toBe(fr);
  });

  it("returns the answer unchanged when trimming would leave nothing", () => {
    const only = answer([{ text: "Die Taxe beträgt 777 Euro.", fact_ids: [FEE.id] }]);
    expect(trimUnaskedValues(only, { question: "Welche Schritte gibt es?", lang: "de", resolve, retrievedIds: [] })).toBe(only);
  });
});

describe("trim: no unasked pass-rule percentage (pr-spt-structure-de, pr-spt-once-en, un-stp-duration-de)", () => {
  const resolve = resolver([STRUCTURE, PASS, ONCE]);

  it("removes the pass-rule sentence from a structure or repeat answer", () => {
    const s = answer([
      { text: "Der Test hat 321 Fragen.", fact_ids: [STRUCTURE.id] },
      { text: "Ein Fach gilt ab 63 Prozent als bestanden.", fact_ids: [PASS.id] },
    ]);
    const out = trimUnaskedValues(s, { question: "Wie ist der Stichprobentest aufgebaut? Wie viele Fragen hat er?", lang: "de", resolve, retrievedIds: [] });
    expect(out.blocks.map((b) => b.text)).toEqual(["Der Test hat 321 Fragen."]);
    expect(out.citations.map((c) => c.fact_id)).toEqual([STRUCTURE.id]);
    const once = answer([{ text: "No, only once. A field counts as passed from 63 percent.", fact_ids: [ONCE.id, PASS.id] }]);
    const o2 = trimUnaskedValues(once, { question: "Can I repeat the Stichprobentest if it goes badly?", lang: "en", resolve, retrievedIds: [] });
    expect(o2.blocks[0].text).toBe("No, only once.");
  });

  it("keeps the percentage for pass-mark questions; 'if I pass' is not one", () => {
    const v = answer([{ text: "Ein Fach gilt ab 63 Prozent als bestanden.", fact_ids: [PASS.id] }]);
    for (const question of ["Wie viel Prozent brauche ich?", "When does the SIP4a count as passed?", "Wann gilt die SIP4a als bestanden?"]) {
      expect(trimUnaskedValues(v, { question, lang: "de", resolve, retrievedIds: [] })).toBe(v);
    }
    const ifPass = answer([
      { text: "Ja, die Prüfung bleibt Pflicht.", fact_ids: [ONCE.id] },
      { text: "Ein Fach gilt ab 63 Prozent als bestanden.", fact_ids: [PASS.id] },
    ]);
    const out = trimUnaskedValues(ifPass, { question: "Do I still have to take it if I pass the Stichprobentest?", lang: "en", resolve, retrievedIds: [] });
    expect(out.blocks.map((b) => b.text)).toEqual(["Ja, die Prüfung bleibt Pflicht."]);
  });
});

describe("trim: no other sittings when one sitting month was asked (dl-stp-may-en, dl-stp-wien-feb-en)", () => {
  const SIT_FEB = { ...TWO_STP[0] };
  const SIT_MAY = { ...TWO_STP[1] };
  const loader = makeLoader([SUMMARY, MAY_ONLY, RULE], TWO_STP);
  const retrieved = [sittingFactId(SIT_FEB), sittingFactId(SIT_MAY), MAY_ONLY.id, SUMMARY.id];
  const resolve = (id: string) => loader.peek(id, NOW);
  const v = () =>
    answer([
      { text: "Your filing cutoff for the 6 May 2099 sitting is 17 March 2099.", fact_ids: [MAY_ONLY.id] },
      { text: "- The sittings are 3 February 2099 and 6 May 2099. The place is the same for everyone.", fact_ids: [SUMMARY.id] },
    ]);

  it("removes the sentence naming the other sitting and keeps the asked sitting's cutoff", () => {
    const out = trimUnaskedValues(v(), { question: "I filed in Vienna. What is my deadline for the May 2099 Stichprobentest?", lang: "en", resolve, retrievedIds: retrieved });
    expect(out.blocks.map((b) => b.text)).toEqual([
      "Your filing cutoff for the 6 May 2099 sitting is 17 March 2099.",
      "- The place is the same for everyone.",
    ]);
  });

  it("does not trim for relative questions, no month, or a follow-up that names none", () => {
    for (const question of ["When is the Stichprobentest after the one in May?", "What is the next Stichprobentest?", "What's the deadline for the SPT?"]) {
      const a = v();
      expect(trimUnaskedValues(a, { question, lang: "en", resolve, retrievedIds: retrieved })).toBe(a);
    }
  });

  it("reads the month of a short follow-up from the previous learner message", () => {
    const input = {
      request: { message: "In Vienna.", lang: "en", mode: "facts" },
      history: [
        { role: "user", content: "What is the registration deadline for the May Stichprobentest?" },
        { role: "assistant", content: "Where did you file?" },
      ],
    } as unknown as MentorTurnInput;
    const q = learnerQuestion(input);
    expect(q).toContain("May Stichprobentest");
    expect(askedMonths(q).map((m) => m.month)).toContain("05");
    const out = trimUnaskedValues(v(), { question: q, lang: "en", resolve, retrievedIds: retrieved });
    expect(JSON.stringify(out.blocks)).not.toContain("3 February");
  });

  it("askedMonths ignores a sentence-initial 'May I' and reads German months", () => {
    expect(askedMonths("May I ask something?")).toEqual([]);
    expect(askedMonths("Frist für den Stichprobentest im Mai 2099?")).toEqual([{ month: "05", year: "2099" }]);
  });

  it("removeSentences only deletes and drops an empty list marker", () => {
    const text = "- Erster Satz 2099-01-01.\n- Zweiter Satz.";
    const vals = extractValues(text);
    expect(removeSentences(text, vals)).toBe("- Zweiter Satz.");
  });
});

describe("fact sheet: core rules are pinned (pr-prescribed, pr-steps)", () => {
  it("puts the pinned ids right after app facts, ahead of earlier topics, under a tight byte cap", () => {
    const pinned = SHEET_PINNED_IDS.map((id) =>
      fact({ id, exam_key: "general", topic: id.includes("glossary") ? "glossary" : "documents", text_de: `Regel ${id}.`, text_en: `Rule ${id}.` })
    );
    const filler = Array.from({ length: 30 }, (_, i) => fact({ id: `fixture.fee.f${String(i).padStart(2, "0")}`, topic: "fee", text_de: "Gebühr.", text_en: "Fee." }));
    const loader = new MentorFactsLoader({ files: () => ({ files: [{ file: "f.json", records: [...filler, ...pinned] }], errors: [] }), sittings: [], appFacts: () => [APP_PLANS], log: () => {} });
    const sheet = loader.sheetFacts(NOW, 5, 100_000).map((f) => f.id);
    expect(sheet[0]).toBe("app.billing.plans");
    expect([...sheet.slice(1, 4)].sort()).toEqual([...SHEET_PINNED_IDS].sort());
    expect(sheet[4]).toBe("fixture.fee.f00");
  });

  it("the real sheet now holds the procedure steps and both always-prescribed rules", () => {
    const sheet = getMentorFactsLoader().sheetFacts(new Date("2026-10-12T08:00:00Z")).map((f) => f.id);
    for (const id of SHEET_PINNED_IDS) expect(sheet).toContain(id);
  });
});

describe("prompt: rules that apply to everyone, steps, sitting month, value scope", () => {
  it("states the scoped individual_ruling, the steps rule, the month rule and existence without value", () => {
    expect(MENTOR_CORE_PROMPT).toMatch(/individual_ruling: what this learner's own application or Bescheid will decide/);
    expect(MENTOR_CORE_PROMPT).toMatch(/always prescribed, so answer yes and cite that fact/);
    expect(MENTOR_CORE_PROMPT).toMatch(/Ermittlungsverfahren, Nostrifizierungsbescheid/);
    expect(MENTOR_CORE_PROMPT).toMatch(/call get_dates with that month/);
    expect(MENTOR_CORE_PROMPT).toMatch(/write its amount or percentage only when the learner asked for it/);
    expect(MENTOR_CORE_PROMPT).not.toMatch(/—/);
  });
});

describe("replay of run1-r1 answers on the real facts", () => {
  const L = getMentorFactsLoader();
  const now = new Date("2026-10-12T08:00:00Z");
  const resolve = (id: string) => L.peek(id, now);

  it("dl-stp-may-en: the other 2027 sittings go, the 17 March cutoff stays", async () => {
    const brain = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien" }, ctx({ now }));
    const v = answer([
      { text: "- Your filing deadline for the Stichprobentest on 4 May 2027 is 17 March 2027.", fact_ids: ["stichprobentest.dates.2027-05-04.both"] },
      { text: "- The 2027 sittings are 3 February at Innsbruck, 4 May at Vienna and 22 September at Graz. The sitting location and date are the same for everyone.", fact_ids: ["stichprobentest.dates.2027-sittings"] },
    ]);
    const out = trimUnaskedValues(v, { question: "I filed in Vienna. What is my deadline for the May 2027 Stichprobentest?", lang: "en", resolve, retrievedIds: r.factIds });
    const text = out.blocks.map((b) => b.text).join("\n");
    expect(text).toContain("17 March 2027");
    expect(text).not.toMatch(/3 February|22 September/);
  });

  it("get_dates with month 2027-05 returns only the May sitting and not the 2027 summary", async () => {
    const brain = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = parse((await brain.runTool("get_dates", { exam_key: "stichprobentest", filing_university: "wien", month: "2027-05" }, ctx({ now }))).content);
    expect((r.sittings as Array<{ date: string }>).map((s) => s.date)).toEqual(["2027-05-04"]);
    expect((r.facts as Array<{ fact_id: string }>).map((f) => f.fact_id)).not.toContain("stichprobentest.dates.2027-sittings");
  });

  it("pr-steps-de: the 150 euro sentence goes, the steps stay", () => {
    const v = answer([
      {
        text: "Zuerst wird der Nostrifizierungsantrag eingereicht.\n- Die Nostrifizierungstaxe von 150 Euro ist im Voraus zu bezahlen und gilt für den Antrag, nicht pro Prüfung.\nDanach folgt das Ermittlungsverfahren.",
        fact_ids: ["general.glossary.procedure-steps", "general.fee.application-taxe"],
      },
    ]);
    const out = trimUnaskedValues(v, { question: "Wie läuft die Nostrifizierung in Wien Schritt für Schritt ab?", lang: "de", resolve, retrievedIds: [] });
    expect(out.blocks[0].text).toBe("Zuerst wird der Nostrifizierungsantrag eingereicht.\nDanach folgt das Ermittlungsverfahren.");
    expect(out.citations.map((c) => c.fact_id)).toEqual(["general.glossary.procedure-steps"]);
  });
});

describe("validator: an echoed anchor month becomes 'danach' (dl-sip4a-feb-de, dl-sip4a-feb-en)", () => {
  const FEB = fact({ id: "fixture.dates.feb", exam_key: "sip4a", topic: "dates", text_de: "SIP4a am 19. Februar 2099.", text_en: "SIP4a on 19 February 2099." });

  it("keeps the date sentence and drops only the unsupported anchor month", () => {
    const de = validateAnswer("@@LANG de\n@@BLOCK facts=fixture.dates.feb\nDer nächste SIP4a-Termin nach dem Termin im November ist am 19. Februar 2099.", [FEB]);
    expect(de.replaced).toBe(false);
    expect(de.blocks[0].text).toBe("Der nächste SIP4a-Termin danach ist am 19. Februar 2099.");
    const en = validateAnswer("@@LANG en\n@@BLOCK facts=fixture.dates.feb\nThe SIP4a sitting after the one in November is on 19 February 2099.", [FEB]);
    expect(en.replaced).toBe(false);
    expect(en.blocks[0].text).toBe("The SIP4a sitting after that is on 19 February 2099.");
    const en2 = validateAnswer("@@LANG en\n@@BLOCK facts=fixture.dates.feb\nAfter the November sitting, the next one is on 19 February 2099.", [FEB]);
    expect(en2.blocks[0].text).toBe("After that, the next one is on 19 February 2099.");
  });

  it("leaves a supported anchor alone and still replaces an invented date", () => {
    const NOV = fact({ id: "fixture.dates.nov", exam_key: "sip4a", topic: "dates", text_de: "SIP4a am 18. November 2098.", text_en: "SIP4a on 18 November 2098." });
    const ok = validateAnswer("@@LANG de\n@@BLOCK facts=fixture.dates.feb,fixture.dates.nov\nNach dem Termin im November ist der nächste am 19. Februar 2099.", [FEB, NOV]);
    expect(ok.blocks[0].text).toContain("im November");
    const bad = validateAnswer("@@LANG de\n@@BLOCK facts=fixture.dates.feb\nDer Termin nach dem im November ist am 20. Februar 2099.", [FEB]);
    expect(bad.replaced).toBe(true);
    expect(JSON.stringify(bad.blocks)).not.toContain("20. Februar");
  });
});
