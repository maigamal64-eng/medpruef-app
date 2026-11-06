/**
 * a-mentor-better-1106: v2 next steps per moment, and the turn loop with the real v2 brain and
 * validator behind a scripted model: find_questions is dispatched only on a v2 turn, a grounded
 * answer gets the deeper offer, the bank provenance and the bank next steps; a no-match refusal
 * gets the practice pointer without MENTOR_RULINGS_NOTICES.
 */
import { describe, expect, it } from "vitest";
import type { MentorFinalEvent, MentorNextAction, MentorSseEvent } from "@/lib/mentor/contract";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { CONCEPT_REFUSAL_LINES } from "@/lib/mentor/rulings-1017";
import { citedQuestionIds, nextActionsV2, offersDeeper, topFoundRow } from "@/lib/mentor/v2/actions";
import type { BankRow, BankSearch } from "@/lib/mentor/v2/find-questions";
import type { ToolResult, TurnContext } from "@/lib/mentor/seam";
import type { MentorV2TurnContext } from "@/lib/mentor/v2/learner-context";
import { collect, makeDeps, request, turnInput, T0 } from "../core/helpers";

const finalOf = (events: MentorSseEvent[]) => events.find((e) => e.type === "final") as MentorFinalEvent;
const NOW = new Date(T0);

const v2ctx = (over: Partial<MentorV2TurnContext> = {}): MentorV2TurnContext => ({
  learner: { activeExam: "kenntnispruefung", sittingBand: "later", weakTopics: ["Psychiatrie"], recentWrongTopics: [], answeredBand: "some" },
  moment: "open",
  depth: "short",
  ...over,
});
function ctx(over: Partial<TurnContext> = {}): TurnContext {
  return { userId: "u1", requestId: "r1", lang: "de", mode: "facts", now: NOW, paidAccess: true, v2: v2ctx(), ...over };
}
const found: ToolResult = { content: JSON.stringify({ rows: [{ id: 101, topic: "Psychiatrie", exam_source: "kenntnispruefung" }] }), factIds: ["question.101"] };
const questionRow: ToolResult = { content: JSON.stringify({ question: { id: 7, topic: "Psychiatrie", exam_type: "kenntnispruefung" } }), factIds: ["question.7"] };

describe("nextActionsV2", () => {
  it("topic: practise the best row's topic, open that row", () => {
    expect(nextActionsV2(ctx(), [{ name: "find_questions", result: found }], [], new Set())).toEqual([]);
    expect(nextActionsV2(ctx(), [{ name: "find_questions", result: found }], [], new Set([101]))).toEqual([
      { kind: "practice_topic", topic: "Psychiatrie", exam_source: "kenntnispruefung" },
      { kind: "open_question", question_id: 101, exam_source: "kenntnispruefung" },
    ]);
  });

  it("after a wrong answer: retry the wrong ones, then practise this topic", () => {
    const v1: MentorNextAction[] = [{ kind: "practice_topic", topic: "Psychiatrie", exam_source: "kenntnispruefung" }, { kind: "open_question", question_id: 7, exam_source: "kenntnispruefung" }];
    const out = nextActionsV2(ctx({ mode: "explain", questionId: 7, v2: v2ctx({ moment: "after_wrong" }) }), [{ name: "get_question", result: questionRow }], v1, new Set([7]));
    expect(out.map((a) => a.kind)).toEqual(["open_mistakes", "practice_topic"]);
    expect(out[0].exam_source).toBe("kenntnispruefung");
  });

  it("exam week: a simulation for paid access and the wrong answers to retry; never a simulation for free access", () => {
    const paid = nextActionsV2(ctx({ v2: v2ctx({ moment: "exam_week" }) }), [], [{ kind: "open_exam_dates" }], new Set());
    expect(paid.map((a) => a.kind)).toEqual(["start_simulation", "open_mistakes", "open_exam_dates"]);
    const free = nextActionsV2(ctx({ paidAccess: false, v2: v2ctx({ moment: "exam_week" }) }), [], [], new Set());
    expect(free.map((a) => a.kind)).toEqual(["open_mistakes"]);
  });

  it("open moment without bank rows keeps today's actions", () => {
    const v1: MentorNextAction[] = [{ kind: "open_exam_dates" }];
    expect(nextActionsV2(ctx(), [], v1, new Set())).toEqual(v1);
  });
});

describe("offersDeeper and topFoundRow", () => {
  it("offers depth after an answered explain or a bank answer, never at depth deep or without v2", () => {
    const c = new Set([101]);
    expect(offersDeeper(ctx({ mode: "explain", questionId: 7, answered: true }), [], new Set())).toBe(true);
    expect(offersDeeper(ctx({ mode: "explain", questionId: 7, answered: false }), [], new Set())).toBe(false);
    expect(offersDeeper(ctx(), [{ name: "find_questions", result: found }], c)).toBe(true);
    expect(offersDeeper(ctx(), [{ name: "find_questions", result: found }], new Set())).toBe(false);
    expect(offersDeeper(ctx({ v2: v2ctx({ depth: "deep" }) }), [{ name: "find_questions", result: found }], c)).toBe(false);
    expect(offersDeeper(ctx({ v2: undefined }), [{ name: "find_questions", result: found }], c)).toBe(false);
    expect(offersDeeper(ctx(), [], c)).toBe(false);
  });
  it("ignores errors, empty rows and malformed rows", () => {
    const all = new Set([1]);
    expect(topFoundRow([{ name: "find_questions", result: { content: "x", factIds: [], isError: true } }], all)).toBeNull();
    expect(topFoundRow([{ name: "find_questions", result: { content: JSON.stringify({ rows: [] }), factIds: [] } }], all)).toBeNull();
    expect(topFoundRow([{ name: "find_questions", result: { content: JSON.stringify({ rows: [{ id: "1", topic: "x", exam_source: "pharma" }] }), factIds: [] } }], all)).toBeNull();
    expect(topFoundRow([{ name: "find_questions", result: { content: JSON.stringify({ rows: [{ id: 1, topic: "x", exam_source: "fsp" }] }), factIds: [] } }], all)).toBeNull();
  });
  it("citedQuestionIds reads only @@BLOCK lines", () => {
    expect([...citedQuestionIds("@@LANG de\n@@BLOCK layer=grounded facts=question.101,question.7\nText question.555\n@@BLOCK facts=sip.pass")]).toEqual([101, 7]);
  });
});

// ─── Turn loop with the real v2 brain and validator ──────────────────────

const BANK: BankRow[] = [{
  id: 101, exam_type: "kenntnispruefung", topic: "Psychiatrie",
  question: "Welches Medikament gehört zu den selektiven Serotonin-Wiederaufnahmehemmern (SSRI)?",
  answer: "Sertralin", explanation: "Sertralin ist ein SSRI und hemmt die Wiederaufnahme von Serotonin.",
  choices: [{ text: "Sertralin", correct: true }, { text: "Haloperidol", correct: false }],
}];
const bankSearch: BankSearch = async ({ keywords }) => BANK.filter((r) => keywords.some((k) => r.question.toLowerCase().includes(k)));

function v2Brain(search: BankSearch = bankSearch) {
  return createMentorBrain({ facts: getMentorFactsLoader(), clock: () => NOW, v2: true, searchBank: search, db: () => ({ from: () => { throw new Error("no db"); } }) as never });
}

async function runV2(steps: Parameters<typeof makeDeps>[0], opts: { v2?: MentorV2TurnContext | null; brain?: ReturnType<typeof v2Brain>; message?: string } = {}) {
  const env = makeDeps(steps, { grantMicro: 500_000 });
  env.deps.brain = opts.brain ?? v2Brain();
  const turn = createRunMentorTurn({ alert: () => {} });
  const v2 = opts.v2 === null ? undefined : opts.v2 ?? v2ctx();
  const events = await collect<MentorSseEvent>(turn(env.deps, turnInput({ request: request({ message: opts.message ?? "Was sind SSRI?" }), ...(v2 ? { v2 } : {}) })));
  return { final: finalOf(events), env };
}

describe("turn loop, v2", () => {
  it("dispatches find_questions, validates against the row, offers depth, bank provenance and bank next steps", async () => {
    const { final, env } = await runV2([
      { text: "", toolUses: [{ id: "t1", name: "find_questions", input: { query_de: "SSRI Serotonin" } }] },
      { text: "@@LANG de\n@@BLOCK layer=grounded facts=question.101\nSSRI hemmen die Wiederaufnahme von Serotonin; ein Beispiel aus den Übungsfragen ist Sertralin." },
    ]);
    expect(final.result).toBe("answer");
    expect(final.answer_blocks.map((b) => b.text).join(" ")).toContain("Sertralin");
    expect(final.offer_deeper).toBe(true);
    expect(final.from_bank).toBe(true);
    expect(final.bank_ids).toEqual([101]);
    expect(final.next_actions).toEqual([
      { kind: "practice_topic", topic: "Psychiatrie", exam_source: "kenntnispruefung" },
      { kind: "open_question", question_id: 101, exam_source: "kenntnispruefung" },
    ]);
    expect(final.charged).toBe(true);
    // The tool result reached the model as data.
    const second = env.claude.calls[1];
    expect(JSON.stringify(second.messages)).toContain("question.101");
  });

  it("flag off: the same tool call is an unknown tool and nothing from the bank is offered", async () => {
    const { final, env } = await runV2([
      { text: "", toolUses: [{ id: "t1", name: "find_questions", input: { query_de: "SSRI" } }] },
      { text: "@@LANG de\n@@REFUSE reason=no_verified_source kind=medical_concept\n@@BLOCK\nDazu habe ich keine Quelle." },
    ], { v2: null, brain: createMentorBrain({ facts: getMentorFactsLoader(), clock: () => NOW }) });
    expect(JSON.stringify(env.claude.calls[1].messages)).toContain('Unknown tool \\"find_questions\\"');
    expect(final.offer_deeper).toBeUndefined();
    expect(final.from_bank).toBeUndefined();
    expect(final.practice_pointer).toBeUndefined(); // MENTOR_RULINGS_NOTICES off, as in production
  });

  it("no matching row: the uncharged practice-pointer refusal, without MENTOR_RULINGS_NOTICES", async () => {
    const { final } = await runV2([
      { text: "", toolUses: [{ id: "t1", name: "find_questions", input: { query_de: "Zebrafisch Genetik" } }] },
      { text: "@@LANG de\n@@REFUSE reason=no_verified_source kind=medical_concept\n@@BLOCK\nDazu gibt es keine Übungsfrage." },
    ]);
    expect(final.refused).toBe("no_verified_source");
    expect(final.practice_pointer).toBe(true);
    expect(final.answer_blocks).toEqual([{ text: CONCEPT_REFUSAL_LINES.de, fact_ids: [] }]);
    expect(final.charged).toBe(false);
    expect(final.offer_deeper).toBeUndefined();
  });

  it("rows found but not cited: no bank line, no bank steps, no deeper offer", async () => {
    const { final } = await runV2([
      { text: "", toolUses: [{ id: "t1", name: "find_questions", input: { query_de: "SSRI" } }] },
      { text: "@@LANG de\n@@REFUSE reason=no_verified_source kind=medical_concept\n@@BLOCK\nDazu gibt es keine passende Übungsfrage." },
    ]);
    expect(final.from_bank).toBeUndefined();
    expect(final.bank_ids).toBeUndefined();
    expect(final.offer_deeper).toBeUndefined();
  });

  it("an invented value the row does not hold is still replaced by the validator", async () => {
    const { final } = await runV2([
      { text: "", toolUses: [{ id: "t1", name: "find_questions", input: { query_de: "SSRI" } }] },
      { text: "@@LANG de\n@@BLOCK layer=grounded facts=question.101\nSertralin ist ein SSRI; die Startdosis ist 50 mg." },
    ]);
    expect(final.answer_blocks.map((b) => b.text).join(" ")).not.toContain("50 mg");
    expect(final.validator_replaced).toBe(true);
  });
});
