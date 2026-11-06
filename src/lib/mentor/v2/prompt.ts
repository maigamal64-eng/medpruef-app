/**
 * Mentor v2 system prompt (a-mentor-better-1106, MENTOR_V2_ENABLED).
 *
 * Built from today's MENTOR_CORE_PROMPT by a few anchored edits, so every rule the trust gate
 * proved stays word for word and v2 differs only where SPEC.md says it does:
 *   1. the UC13 refusal line becomes the grounded route (find_questions, bank rows only);
 *   2. find_questions joins the always-in-scope tools;
 *   3. explain answers are short first (about 60 words) and deep on request (about 150);
 *   4. the output cap is about 80 words (deep: about 150);
 *   5. WHAT YOU DO names medical topics and pasted practice questions.
 * The fact sheet (block 1, the cache breakpoint) is today's builder, byte for byte. The learner
 * context goes into block 2, after the breakpoint. Flag off, none of this runs: the brain keeps
 * buildSystemBlocks (prompt/system.ts), which this file never changes.
 */

import type { TextBlockParam } from "@/lib/ai/anthropic";
import type { MentorFact, TurnContext } from "../seam";
import { MENTOR_CORE_PROMPT, buildFactSheet, buildTurnContext } from "../prompt/system";
import { learnerContextLines, type MentorV2TurnContext } from "./learner-context";

/** Replaces the whole line that starts with `start` (up to its newline). */
type LineEdit = { kind: "line"; start: string; to: string };
/** Replaces an exact substring. */
type TextEdit = { kind: "text"; from: string; to: string };

export const MENTOR_V2_PROMPT_EDITS: ReadonlyArray<LineEdit | TextEdit> = [
  {
    kind: "line",
    start: "- A free-form medical question when the turn context names no question id,",
    to:
      "- A medical or exam-content question when the turn context names no question id (a drug class, a disease, a sign, a mechanism, \"What are SSRIs?\", \"What is the antidote for heparin?\"), or a pasted practice question or case vignette (\"Ein 61-jähriger Mann ... Welche ist die wahrscheinlichste Diagnose?\"): call find_questions first, with German medical keywords (for a pasted question: its key findings and what it asks). " +
      "Answer only from the rows it returns and cite each row you use (@@BLOCK layer=grounded facts=<its fact_id>). For a topic: one to three sentences that answer the question from the rows' keyed answers and explanations. For a pasted question that matches a row: explain that row in the EXPLAIN SHAPE (the keyed answer by its text, the stem findings that point to it). " +
      "Add nothing the rows do not state: no other drug, dose, number, name or claim from your own knowledge, and no background layer. Call the rows practice questions (Übungsfragen). " +
      "If find_questions returns no rows, or the rows do not answer what was asked, refuse with @@REFUSE reason=no_verified_source kind=medical_concept and nothing else, never with out_of_scope. " +
      "Advice about a real patient or the learner's own health or medication stays @@REFUSE reason=patient_advice (never kind=medical_concept), also without a question id; a third-person exam case or a textbook question is never patient advice. The app adds the practice buttons for the topic.",
  },
  {
    kind: "text",
    from: "- Explaining a question (get_question) and study planning (get_my_progress) are always in scope",
    to: "- Explaining a question (get_question), answering from practice questions (find_questions) and study planning (get_my_progress) are always in scope",
  },
  {
    kind: "text",
    from: "Otherwise use about 120 words, with two required parts: a one-line core reason, then why the learner's selected option (or the closest distractor) fails.",
    to: "Otherwise follow depth in the learner context. Short (the default) is two to four sentences, about 60 words, with two required parts: a one-line core reason, then why the learner's selected option (or the closest distractor) fails. Deep is about 150 words.",
  },
  {
    kind: "text",
    from: "which the app hides behind an Explain all options disclosure.",
    to: "which the app hides behind an Explain all options disclosure; write that layer only at depth deep.",
  },
  {
    kind: "text",
    from: "at most about 120 words;",
    to: "at most about 80 words (depth deep: about 150);",
  },
  {
    kind: "text",
    from: "\n\nHOW TO ANSWER\n",
    to: "\n6. Medical topics and pasted practice questions with no question id: answer from the practice question bank with find_questions (see HOW TO ANSWER), never from your own knowledge.\n\nHOW TO ANSWER\n",
  },
];

/** Applies the edits; throws when an anchor is missing or not unique (a test pins all of them). */
export function applyV2Edits(core: string): string {
  let out = core;
  for (const e of MENTOR_V2_PROMPT_EDITS) {
    const anchor = e.kind === "line" ? e.start : e.from;
    const at = out.indexOf(anchor);
    if (at < 0 || out.indexOf(anchor, at + 1) >= 0) throw new Error(`mentor v2 prompt: anchor missing or not unique: ${anchor.slice(0, 60)}`);
    if (e.kind === "line") {
      const end = out.indexOf("\n", at);
      out = out.slice(0, at) + e.to + (end < 0 ? "" : out.slice(end));
    } else {
      out = out.slice(0, at) + e.to + out.slice(at + anchor.length);
    }
  }
  return out;
}

let cached: string | null = null;
/** Built lazily: only a v2 turn ever needs it, so a drifted anchor can never break a flag-off turn. */
export function mentorCorePromptV2(): string {
  if (cached === null) cached = applyV2Edits(MENTOR_CORE_PROMPT);
  return cached;
}

export const DEFAULT_V2_CONTEXT: MentorV2TurnContext = Object.freeze({ learner: null, moment: "open", depth: "short" }) as MentorV2TurnContext;

const V2_TOOL_LINE = "A medical question goes to find_questions in every mode (a question id in the turn context: get_question, as before).";

export function buildTurnContextV2(ctx: TurnContext): string {
  const ids = ctx.v2?.depth === "deep" ? (ctx.v2.previousBankIds ?? []).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 3) : [];
  // Ids are code-checked integers from the previous final event; the model passes them to the tool, never into the text.
  const deeper = ids.length > 0 ? `\nThe learner asks for more depth on your previous answer from practice questions: call find_questions with ids [${ids.join(", ")}] (the rows it used) and answer from them.` : "";
  return `${buildTurnContext(ctx)}\n${V2_TOOL_LINE}${deeper}\n${learnerContextLines(ctx.v2 ?? DEFAULT_V2_CONTEXT)}`;
}

export function buildSystemBlocksV2(ctx: TurnContext, sheetFacts: readonly MentorFact[]): TextBlockParam[] {
  return [
    { type: "text", text: mentorCorePromptV2() },
    { type: "text", text: buildFactSheet(sheetFacts), cache_control: { type: "ephemeral" } },
    { type: "text", text: buildTurnContextV2(ctx) },
  ];
}
