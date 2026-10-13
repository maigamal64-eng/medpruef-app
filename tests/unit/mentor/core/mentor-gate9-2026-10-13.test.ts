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
import { fact } from "../brain/helpers";

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
