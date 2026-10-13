/**
 * Live trust gate round 9 (a-mentor-gate9, [name] 13 Oct: precision bar stays 0 of 90,
 * fund a prompt round). A complete answer the validator would partly replace only
 * because a value stands outside the facts its block cites gets one citation repair:
 * a text-only call with code-owned checker feedback. The repair is delivered only when
 * the validator keeps it whole; the learner pays for at most one answer.
 * Plus the P1 study path: the learner's own exam date and days left reach a study
 * answer only through the code-owned line.
 */
import { describe, expect, it } from "vitest";
import { costMicroUsd } from "@/lib/ai/pricing";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { createRunMentorTurn, ownExamDateFromTools, type MentorAlert } from "@/lib/mentor/turn";
import { citationRepairInstruction, isCitationRepairable, removedSentences } from "@/lib/mentor/citation-repair";
import { dropCountWords, validateAnswer } from "@/lib/mentor/validator";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import type { Brain, ValidatedAnswer } from "@/lib/mentor/seam";
import { USER, collect, makeDeps, request, turnInput, usage, type Step } from "./helpers";
import { ctx, fact, fakeDb } from "../brain/helpers";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";

const MODEL = "claude-haiku-5-5";
const GRANT = 200_000;

const replacedBy = (reason: string, value = "2"): ValidatedAnswer => ({
  blocks: [{ text: "Teil der Antwort.", fact_ids: [] }, { text: "Diese Angabe ist nicht offiziell bestätigt.", fact_ids: [], replaced: true }],
  citations: [],
  replaced: true,
  rejected: [{ value, reason: reason as never }],
});
const clean: ValidatedAnswer = { blocks: [{ text: "Ganze Antwort.", fact_ids: [] }], citations: [], replaced: false, rejected: [] };

function run(steps: Step[], validate: Brain["validate"], elapsedNow?: () => number) {
  const env = makeDeps(steps, { grantMicro: GRANT, brain: { validate } });
  const alerts: MentorAlert[] = [];
  const turn = createRunMentorTurn({ alert: (a) => alerts.push(a), ...(elapsedNow ? { elapsedNow } : {}) });
  return { ...env, alerts, events: collect<MentorSseEvent>(turn(env.deps, turnInput())) };
}
const finalOf = (events: MentorSseEvent[]) => events.find((e) => e.type === "final") as MentorFinalEvent;
const booked = (ledger: ReturnType<typeof makeDeps>["ledger"]) => ledger.entries.filter((e) => e.kind === "settle" || e.kind === "house_cost").map((e) => [e.kind, e.cost]);
const byText = (bad: ValidatedAnswer) => (answer: string) => (answer.includes("FIRST") ? bad : clean);

describe("citation repair: one text-only call, delivered only when kept whole", () => {
  it("a repaired answer replaces the first; the first is the house's, the repair the learner's", async () => {
    const u1 = usage(1200, 300);
    const u2 = usage(1300, 320);
    const t = run([{ text: "FIRST In Graz zwei Jahre.", usage: u1 }, { text: "SECOND", usage: u2 }], byText(replacedBy("not_in_cited_facts")));
    const f = finalOf(await t.events);
    expect(t.claude.calls).toHaveLength(2);
    expect(t.claude.calls[1].tool_choice).toEqual({ type: "none" });
    const last = t.claude.calls[1].messages.at(-1);
    expect(Array.isArray(last?.content) && last.content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("CHECKER FEEDBACK") });
    expect(f.answer_blocks.map((b) => b.text)).toEqual(["Ganze Antwort."]);
    expect(f).toMatchObject({ result: "answer", charged: true, retries: 1 });
    expect(f.validator_replaced).toBeUndefined();
    expect(booked(t.ledger)).toEqual([["house_cost", costMicroUsd(MODEL, u1)], ["settle", costMicroUsd(MODEL, u2)]]);
    expect(t.alerts.map((a) => a.detail)).toContain("citation repair kept");
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it("an uncited number is repairable too", async () => {
    const t = run([{ text: "FIRST" }, { text: "SECOND" }], byText(replacedBy("uncited_number")));
    expect(finalOf(await t.events).charged).toBe(true);
    expect(t.claude.calls).toHaveLength(2);
  });

  it("a repair the validator replaces again: the first answer stays, all house", async () => {
    const t = run([{ text: "FIRST" }, { text: "FIRST again" }], byText(replacedBy("not_in_cited_facts")));
    const f = finalOf(await t.events);
    expect(f.validator_replaced).toBe(true);
    expect(f.charged).toBe(false);
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["house_cost", "house_cost"]);
    expect(t.alerts.map((a) => a.detail)).toContain("citation repair discarded");
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it.each(["study_safety", "unknown_fact_id"])("never for a %s rejection", async (reason) => {
    const t = run([{ text: "FIRST" }], byText(replacedBy(reason)));
    await t.events;
    expect(t.claude.calls).toHaveLength(1);
  });

  it("never for a background layer with numbers or doses", async () => {
    const t = run([{ text: "FIRST" }], byText(replacedBy("not_in_cited_facts", "background_numbers_or_doses")));
    await t.events;
    expect(t.claude.calls).toHaveLength(1);
  });

  it("never for a refusal or a whole answer", async () => {
    const refusal = run([{ text: "FIRST" }], () => ({ ...replacedBy("not_in_cited_facts"), refused: "individual_ruling" }));
    await refusal.events;
    expect(refusal.claude.calls).toHaveLength(1);
    const whole = run([{ text: "FIRST" }], () => clean);
    await whole.events;
    expect(whole.claude.calls).toHaveLength(1);
  });

  it("a repair cut off at the output cap keeps the first answer, all house", async () => {
    const t = run([{ text: "FIRST" }, { text: "SECOND cut", stopReason: "max_tokens" }], byText(replacedBy("not_in_cited_facts")));
    const f = finalOf(await t.events);
    expect(f.validator_replaced).toBe(true);
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["house_cost", "house_cost"]);
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it("a repair that fails keeps the first answer", async () => {
    const t = run([{ text: "FIRST" }, { throw: new Error("boom") }], byText(replacedBy("not_in_cited_facts")));
    const f = finalOf(await t.events);
    expect(f.answer_blocks[0].text).toBe("Teil der Antwort.");
    expect(f.charged).toBe(false);
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it("no repair without the time for a call", async () => {
    let now = 0;
    const t = run([{ text: "FIRST" }, { text: "SECOND" }], byText(replacedBy("not_in_cited_facts")), () => (now += 25_000));
    await t.events;
    expect(t.claude.calls).toHaveLength(1);
  });

  it("only once per turn", async () => {
    const t = run([{ text: "FIRST" }, { text: "FIRST" }, { text: "SECOND" }], byText(replacedBy("not_in_cited_facts")));
    await t.events;
    expect(t.claude.calls).toHaveLength(2);
  });
});

describe("citation repair feedback", () => {
  const graz = fact({ id: "c1.language.graz-c1", exam_key: "c1", topic: "language", text_de: "MedUni Graz: Der C1-Nachweis darf nicht älter als 2 Jahre sein.", text_en: "MedUni Graz: the C1 proof may not be older than 2 years." });
  const vienna = fact({ id: "c1.language.vienna-c1-proof", exam_key: "c1", topic: "language", text_de: "MedUni Wien: nicht älter als drei Jahre.", text_en: "MedUni Wien: not older than three years." });
  const raw = `@@LANG de\n@@BLOCK facts=${vienna.id}\nDer Nachweis darf laut MedUni Wien nicht älter als drei Jahre sein. In Graz darf er nicht älter als 2 Jahre sein.`;

  it("gate8 r2 pr-c1-de: the validator rejects it, the feedback quotes the sentence and names the retrieved Graz row", () => {
    const v = validateAnswer(raw, [vienna, graz]);
    expect(isCitationRepairable(v)).toBe(true);
    expect(removedSentences(raw, v.rejected)).toEqual([{ sentence: "In Graz darf er nicht älter als 2 Jahre sein.", values: ["2"] }]);
    const s = citationRepairInstruction(raw, v, [vienna, graz]);
    expect(s).toContain('"In Graz darf er nicht älter als 2 Jahre sein." (value: 2)');
    expect(s).toContain("c1.language.graz-c1");
    expect(s).not.toContain("c1.language.vienna-c1-proof");
    expect(s).not.toContain("@@BLOCK facts=");
    expect(s).not.toMatch(/—/);
  });

  it("the prompt states the three rules the feedback repeats", () => {
    expect(MENTOR_CORE_PROMPT).toMatch(/start a new @@BLOCK/);
    expect(MENTOR_CORE_PROMPT).toMatch(/another block/);
  });
});

describe("P1: the own exam date reaches a study answer only through the code-owned line", () => {
  it("reads exam_date and days_left from get_my_progress, never a past date or a failed tool", () => {
    const ok = { name: "get_my_progress", result: { content: JSON.stringify({ exam_date: "2027-02-03", days_left: 114 }), factIds: [] } };
    expect(ownExamDateFromTools([ok])).toEqual({ examDate: "2027-02-03", daysLeft: 114 });
    expect(ownExamDateFromTools([{ ...ok, result: { ...ok.result, content: JSON.stringify({ exam_date: "2027-02-03", days_left: null }) } }])).toBeNull();
    expect(ownExamDateFromTools([{ ...ok, result: { ...ok.result, isError: true } }])).toBeNull();
    expect(ownExamDateFromTools([{ name: "get_dates", result: ok.result }])).toBeNull();
  });

  it("a study turn appends the line once; a fact turn does not", async () => {
    const progress = JSON.stringify({ fact_id: "progress.x", exam_date: "2027-02-03", days_left: 114 });
    const study = turnInput({ request: request({ mode: "study", message: "Lernplan bitte", lang: "de" }) });
    const env = makeDeps([{ text: "", toolUses: [{ id: "t1", name: "get_my_progress" }] }, { text: "Zuerst HNO." }], {
      grantMicro: GRANT,
      brain: { runTool: async () => ({ content: progress, factIds: [] }), validate: () => ({ blocks: [{ text: "Zuerst HNO.", fact_ids: [] }], citations: [], replaced: false, rejected: [] }) },
    });
    const f = finalOf(await collect<MentorSseEvent>(createRunMentorTurn({ alert: () => {} })(env.deps, study)));
    expect(f.answer_blocks.map((b) => b.text)).toEqual(["Zuerst HNO.", "Ihr selbst eingetragenes Prüfungsdatum ist der 3. Februar 2027 (noch 114 Tage); das ist kein offizieller Termin und keine Frist."]);
    expect(f.answer_blocks[1].confirmed_dates).toBeUndefined();
  });
});

describe("a count before other/remaining is wording, not a value (gate8 r2 ex-protamine-en)", () => {
  it.each([
    ["The explanation covers the two other antidotes named above.", "The explanation covers the other antidotes named above."],
    ["These 3 remaining options do not fit.", "These remaining options do not fit."],
    ["Die zwei anderen Antidote passen nicht.", "Die anderen Antidote passen nicht."],
    ["Diese drei übrigen Optionen sind falsch.", "Diese übrigen Optionen sind falsch."],
  ])("%s", (input, out) => expect(dropCountWords(input)).toBe(out));

  it.each([
    "the two other attempts are commission attempts",
    "the two other universities accept it",
    "die zwei anderen Antritte sind kommissionell",
    "two other antidotes exist",
  ])("never a value noun, another noun or a count without a determiner: %s", (input) => expect(dropCountWords(input)).toBe(input));
});

describe("search_facts: a language query under exam general also reads the c1 facts (gate9 targeted pr-c1-de)", () => {
  const now = new Date("2026-10-12T08:00:00Z");
  const brain = createMentorBrain({ facts: getMentorFactsLoader(), db: () => fakeDb({}).db, clock: () => now });
  it("Deutschniveau under general returns the C1 rows and keeps the general language row", async () => {
    const r = await brain.runTool("search_facts", { query_de: "Deutschniveau Nostrifizierung", exam_key: "general" }, ctx({ now, lang: "de" }));
    expect(r.factIds).toContain("general.language.exams-in-german");
    expect(r.factIds.filter((id) => id.startsWith("c1.language.")).length).toBeGreaterThan(0);
  });
  it("a non-language query under general stays general only", async () => {
    const r = await brain.runTool("search_facts", { query_de: "Antrag Unterlagen Beglaubigung", exam_key: "general" }, ctx({ now, lang: "de" }));
    expect(r.factIds.every((id) => id.startsWith("general."))).toBe(true);
  });
});

describe("P1 re-review: days left and countdowns in progress-grounded blocks (sentence-wide)", () => {
  const PROGRESS_TEXT = [
    "Gewählte Prüfung: stichprobentest",
    "Prüfungsdatum (selbst eingetragen): 2027-02-03, noch 114 Tage",
    "Gesamt: 81 beantwortet, 46 richtig, 57 %",
    "Schwach: Gynäkologie: 14 beantwortet, 36 %",
    "Schwach: HNO: 10 beantwortet, 40 %",
  ].join("\n");
  const progress = fact({ id: "progress.00000000-0000-4000-9000-000000000091", exam_key: "general", topic: "glossary", text_de: PROGRESS_TEXT, text_en: PROGRESS_TEXT, read_on: "2026-10-12" });
  const lead = "Am schwächsten sind Sie in HNO mit 40 %.";
  const check = (sentence: string, cited = true) =>
    validateAnswer(`@@LANG de\n@@BLOCK${cited ? ` facts=${progress.id}` : ""}\n${lead} ${sentence}`, [progress], { retrievedIds: [progress.id], resolve: (id) => (id === progress.id ? progress : null) });
  const all = (v: ValidatedAnswer) => v.blocks.map((b) => b.text).join("\n");

  it.each([
    "Sie haben noch 114 Tage, bis die Anmeldefrist endet.",
    "Ihnen bleiben noch 114 Tage, dann schließt die Anmeldung.",
    "You have 114 days left, and then registration closes.",
    "Sie haben noch 114 Tage; melden Sie sich rechtzeitig an.",
    "Die Anmeldefrist endet in 114 Kalendertagen.",
    "Registration closes in 114 calendar days.",
    "Registration closes in 114 more days.",
    "Die Anmeldefrist endet in 81 Wochen.",
    "Registration closes in 14 weeks.",
    "Bis zur Prüfung bleiben 114 Tage.",
    "You have 114 days until the exam.",
    "Laut MedUni Wien bleiben 114 Tage.",
  ])("deleted, never shown (cited and uncited): %s", (sentence) => {
    for (const cited of [true, false]) {
      const v = check(sentence, cited);
      expect(all(v)).not.toContain(sentence);
      expect(all(v)).toContain(lead);
      expect(v.rejected.every((r) => r.reason === "own_exam_date")).toBe(true);
      expect(isCitationRepairable(v)).toBe(false);
    }
  });

  it.each([
    "Ihnen bleiben noch 114 Tage.",
    "You have 114 days left to prepare.",
    "Sie haben noch 114 Tage bis zu Ihrem eingetragenen Prüfungsdatum.",
    "Your entered exam date is in 114 days.",
    "Bis zu Ihrer Prüfung sind es noch 114 Tage.",
  ])("kept verbatim, an allowlisted own-time sentence: %s", (sentence) => {
    const v = check(sentence);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain(sentence);
  });

  // Re-review round 2 (allowlist instead of a sixth deny-list round): any other sentence with the own
  // days left is restated by the code-owned line, never shown in model wording.
  it.each([
    "Die 114-Tage-Frist beginnt jetzt.",
    "Registration has a 114-day deadline.",
    "Your exam is in 114 days, not an official deadline, so register now.",
    "You have 114 days left, the paperwork is due before then.",
    "Sie haben noch 114 Tage, reichen Sie Ihre Unterlagen bald ein.",
    "You have 114 days left; apply soon.",
    "You have 114 days left, so book your slot soon.",
    "In 114 Tagen ist Ihre Prüfung, bis dahin ist alles fällig.",
    "Ihnen bleiben noch 114 Werktage.",
    "Ihr eingetragenes Prüfungsdatum ist in 114 Tagen erreicht; es ist Ihr eigener Eintrag und keine offizielle Termin- oder Fristangabe.",
  ])("restated by the code-owned line (cited and uncited): %s", (sentence) => {
    for (const cited of [true, false]) {
      const v = check(sentence, cited);
      expect(all(v)).not.toContain(sentence);
      expect(all(v)).toContain(lead);
      expect(all(v)).toContain("Ihr selbst eingetragenes Prüfungsdatum ist der 3. Februar 2027 (noch 114 Tage); das ist kein offizieller Termin und keine Frist.");
      for (const b of v.blocks) expect(b.confirmed_dates).toBeUndefined();
    }
  });

  it("the repair feedback never names the progress row", () => {
    const raw = `@@LANG de\n@@BLOCK facts=${progress.id}\n${lead} Die Anmeldefrist endet in 114 Tagen.`;
    const v = check("Die Anmeldefrist endet in 114 Tagen.");
    expect(citationRepairInstruction(raw, { ...v, rejected: [{ value: "114", reason: "not_in_cited_facts" }] }, [progress])).not.toContain(progress.id);
  });

  it("a kept sentence is never quoted as removed", () => {
    expect(removedSentences("@@BLOCK facts=a\nEs sind 2 Teile.\n@@BLOCK facts=b\nIn Graz 2 Jahre.", [{ value: "2" }], [{ text: "Es sind 2 Teile." }])).toEqual([{ sentence: "In Graz 2 Jahre.", values: ["2"] }]);
  });

  it("a hint never names another university's row", () => {
    const graz = fact({ id: "c1.language.graz-c1", exam_key: "c1", topic: "language", filing_university: "graz", text_de: "Nicht älter als 2 Jahre.", text_en: "Not older than 2 years." });
    const s = citationRepairInstruction("@@BLOCK facts=x\nIn Wien darf er nicht älter als 2 Jahre sein.", { rejected: [{ value: "2", reason: "not_in_cited_facts" }], blocks: [] }, [graz]);
    expect(s).not.toContain("c1.language.graz-c1");
  });
});

describe("citation repair edge cases (re-review P3)", () => {
  it("a repair with only the fallback line is discarded", async () => {
    const fallback: ValidatedAnswer = { blocks: [{ text: "Diese Angabe ist nicht offiziell bestätigt.", fact_ids: [] }], citations: [], replaced: false, rejected: [] };
    const t = run([{ text: "FIRST" }, { text: "SECOND" }], (a) => (a.includes("FIRST") ? replacedBy("not_in_cited_facts") : fallback));
    const f = finalOf(await t.events);
    expect(f.answer_blocks[0].text).toBe("Teil der Antwort.");
    expect(t.alerts.map((a) => a.detail)).toContain("citation repair discarded");
  });

  it("a refused repair call keeps the first answer, all house", async () => {
    const { AiRefusal } = await import("@/lib/ai/anthropic");
    const t = run([{ text: "FIRST" }, { throw: new AiRefusal("no", { usage: usage(900, 10), stop_details: null, blocks: [], partialText: "" }) }], byText(replacedBy("not_in_cited_facts")));
    const f = finalOf(await t.events);
    expect(f.answer_blocks[0].text).toBe("Teil der Antwort.");
    expect(f.refused).toBeUndefined();
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["house_cost", "house_cost"]);
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });
});

describe("P1 re-review round 3: no bare own days, no value-free deadline on the own date", () => {
  const PROGRESS_TEXT = [
    "Gewählte Prüfung: stichprobentest",
    "Prüfungsdatum (selbst eingetragen): 2027-02-03, noch 114 Tage",
    "Gesamt: 81 beantwortet, 46 richtig, 57 %",
    "Schwach: HNO: 10 beantwortet, 40 %",
  ].join("\n");
  const progress = fact({ id: "progress.00000000-0000-4000-9000-000000000092", exam_key: "general", topic: "glossary", text_de: PROGRESS_TEXT, text_en: PROGRESS_TEXT, read_on: "2026-10-12" });
  const lead = "Am schwächsten sind Sie in HNO mit 40 %.";
  const check = (sentence: string, cited = true) =>
    validateAnswer(`@@LANG de\n@@BLOCK${cited ? ` facts=${progress.id}` : ""}\n${lead} ${sentence}`, [progress], { retrievedIds: [progress.id], resolve: (id) => (id === progress.id ? progress : null) });
  const all = (v: ValidatedAnswer) => v.blocks.map((b) => b.text).join("\n");

  it.each([
    "Countdown bis zur Anmeldefrist: 114.",
    "Noch 114 bis zum Anmeldeschluss.",
    "Tage bis zur Anmeldefrist: 114.",
    "Registration closes T-114.",
    "Registration closes on your exam date.",
    "Die Anmeldefrist endet an Ihrem Prüfungsdatum.",
    "Melden Sie sich bis dahin an.",
    "Die Anmeldung schließt nach 81 Fragen.",
  ])("deleted (cited and uncited): %s", (sentence) => {
    for (const cited of [true, false]) {
      const v = check(sentence, cited);
      expect(all(v)).not.toContain(sentence);
      expect(all(v)).toContain(lead);
      expect(v.rejected.every((r) => r.reason === "own_exam_date")).toBe(true);
      expect(isCitationRepairable(v)).toBe(false);
    }
  });

  it("an allowed own-time sentence followed by a value-free deadline: only the deadline goes", () => {
    const v = check("You have 114 days left until your exam. Registration closes then.");
    expect(all(v)).toContain("You have 114 days left until your exam.");
    expect(all(v)).not.toContain("Registration closes then.");
  });

  it("the code-owned line itself (it names a Frist) is never deleted", () => {
    const v = check("Ihr selbst eingetragenes Prüfungsdatum ist der 3. Februar 2027.");
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain("das ist kein offizieller Termin und keine Frist.");
  });

  it("a plan sentence with progress numbers and no deadline word stays", () => {
    const v = check("Zum Schluss wiederholen Sie HNO (40 %) und alle 81 beantworteten Fragen.");
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
  });
});

describe("re-review 4: the registration rule in study blocks is exact (no false positives) and covers anaphora", () => {
  const PROGRESS_TEXT = [
    "Gewählte Prüfung: stichprobentest",
    "Prüfungsdatum (selbst eingetragen): 2027-02-03, noch 114 Tage",
    "Gesamt: 81 beantwortet, 46 richtig, 57 %",
    "Schwach: Gynäkologie: 14 beantwortet, 36 %",
    "Schwach: HNO: 10 beantwortet, 40 %",
    "Stark: Pädiatrie: 19 beantwortet, 79 %",
  ].join("\n");
  const progress = fact({ id: "progress.00000000-0000-4000-9000-000000000093", exam_key: "general", topic: "glossary", text_de: PROGRESS_TEXT, text_en: PROGRESS_TEXT, read_on: "2026-10-12" });
  const check = (body: string) =>
    validateAnswer(`@@LANG de\n@@BLOCK facts=${progress.id}\n${body}`, [progress], { retrievedIds: [progress.id], resolve: (id) => (id === progress.id ? progress : null) });
  const all = (v: ValidatedAnswer) => v.blocks.map((b) => b.text).join("\n");

  it.each([
    "Langfristig festigen Sie Pädiatrie (79 %) mit gemischten Fragen.",
    "Kurzfristig üben Sie HNO (40 %).",
    "Wiederholen Sie zuerst die fälligen Karten, dann üben Sie HNO.",
    "First, review the cards that are due, then practise HNO.",
    "Then work through your due reviews in Gynäkologie (36 %).",
    "Nutzen Sie die Rückmeldung zu falschen Antworten in HNO (40 %).",
    "Melden Sie fehlerhafte Fragen über die Meldefunktion, dann üben Sie weiter.",
    "Submit your answers in timed blocks, then review the mistakes.",
    "Before your exam, check the registration deadline on the official page.",
    // Recorded gate4 to gate8 study answers: disclaimers that something is not a deadline.
    "This is the date you entered yourself, not an official sitting or deadline.",
    "No exam date is entered in your progress, so the plan is not tied to a deadline yet.",
    "Ihr Datum ist kein offizieller Termin und keine Frist.",
    "This is your own date entry, not an official sitting or deadline.",
    "Das Prüfungsdatum ist Ihr eigener Eintrag und keine offizielle Termin- oder Fristangabe.",
    "You have not entered an exam date yet, so your plan is not tied to a deadline.",
    "Bis zu Ihrer Prüfung festigen Sie Pädiatrie (79 %); die Anmeldefrist prüfen Sie auf der offiziellen Seite.",
  ])("kept: %s", (sentence) => {
    const v = check(sentence);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain(sentence);
  });

  it.each([
    ["You have 114 days left to prepare.", "That is also when registration closes."],
    ["You have 114 days left to prepare.", "The registration window ends at the same time."],
    ["Ihnen bleiben noch 114 Tage.", "Genau so lange läuft auch die Anmeldung."],
    ["You have 114 days left to prepare.", "After that, applications are no longer accepted."],
    ["Ihnen bleiben noch 114 Tage.", "Danach werden keine Anträge mehr angenommen."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Your exam date is the last day to register."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "There is no registration deadline before your exam."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "There is not a deadline before your exam."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Es gibt keine Frist vor Ihrer Prüfung."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Bis zu Ihrer Prüfung gilt keine Frist."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Für Sie gilt keine Frist, Sie können jederzeit einsteigen."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Your exam is not tied to a deadline, so take your time."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Ihre Prüfung ist nicht an eine Frist gebunden."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "This is not a deadline you can ignore."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Ihr Prüfungsdatum ist keine Frist, die Sie verpassen dürfen."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Bis dahin müssen die Unterlagen eingereicht sein."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "Your documents must be submitted by then."],
    ["Am schwächsten sind Sie in HNO mit 40 %.", "It is not an official deadline, but treat it as one and finish your papers by then."],
  ])("the own-time sentence stays, the deadline anaphora goes: %s %s", (first, second) => {
    const v = check(`${first} ${second}`);
    expect(all(v)).toContain(first);
    expect(all(v)).not.toContain(second);
    expect(v.rejected.every((r) => r.reason === "own_exam_date")).toBe(true);
  });
});
