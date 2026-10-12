/**
 * Per-field status against the 60 percent mark (CNT-42). Pure.
 *
 * Basis, stated on the page: practice accuracy per subject from the learner's
 * own answers (user_topic_strength), only for subjects with at least
 * MIN_TOPIC_SAMPLE answers. Timed simulations are still too rare to carry this
 * (6 runs by 3 learners on 2026-10-11), so this is practice accuracy and the
 * page says so. It is never a pass probability: a field is "at" the mark only
 * at 60.0 percent or more, and "ready" needs every field with enough answers
 * at the mark and no field without enough answers.
 */
import { MIN_TOPIC_SAMPLE } from "./learning-metrics";
import { VIENNA_EXAM_PARTS } from "./topics";

export const FIELD_MARK_PCT = 60;

export interface FieldInput {
  topic: string;
  answered: number;
  correct: number;
}

export type FieldState = "at_mark" | "below_mark" | "too_few";

export interface FieldStatus {
  field: string;
  /** SIP part for the Vienna bank, null elsewhere. */
  part: "sip4" | "sip5" | null;
  answered: number;
  correct: number;
  /** Unrounded accuracy in percent, null below the minimum sample. */
  pct: number | null;
  state: FieldState;
}

export interface FieldReadiness {
  fields: FieldStatus[];
  minAnswered: number;
  measured: number;
  atMark: number;
  belowMark: number;
  tooFew: number;
  /** Every field has enough answers and every field is at 60 percent or more. */
  allAtMark: boolean;
}

function partOf(topic: string): "sip4" | "sip5" | null {
  if (VIENNA_EXAM_PARTS.sip4.includes(topic)) return "sip4";
  if (VIENNA_EXAM_PARTS.sip5.includes(topic)) return "sip5";
  return null;
}

export function fieldState(answered: number, correct: number, minAnswered = MIN_TOPIC_SAMPLE): { pct: number | null; state: FieldState } {
  const a = Math.max(0, Math.floor(answered));
  if (a < minAnswered || a === 0) return { pct: null, state: "too_few" };
  const pct = (Math.max(0, Math.min(correct, a)) / a) * 100;
  return { pct, state: pct >= FIELD_MARK_PCT ? "at_mark" : "below_mark" };
}

/**
 * Fields for a bank: the Vienna bank uses its ten SIP subjects (missing ones
 * count as not answered), other banks the topics the learner's bank lists.
 */
export function buildFieldReadiness(
  bank: string,
  rows: readonly FieldInput[],
  bankTopics: readonly string[] = [],
  minAnswered = MIN_TOPIC_SAMPLE,
): FieldReadiness {
  const byTopic = new Map(rows.map((r) => [r.topic, r]));
  const names =
    bank === "kenntnispruefung"
      ? [...VIENNA_EXAM_PARTS.sip4, ...VIENNA_EXAM_PARTS.sip5]
      : Array.from(new Set([...bankTopics, ...rows.map((r) => r.topic)]));
  const fields: FieldStatus[] = names.map((field) => {
    const r = byTopic.get(field);
    const answered = Math.max(0, Math.floor(r?.answered ?? 0));
    const correct = Math.max(0, Math.floor(r?.correct ?? 0));
    const { pct, state } = fieldState(answered, correct, minAnswered);
    return { field, part: bank === "kenntnispruefung" ? partOf(field) : null, answered, correct, pct, state };
  });
  // Weakest first: below the mark (lowest accuracy first), then too few, then at the mark.
  const rank = (f: FieldStatus) => (f.state === "below_mark" ? 0 : f.state === "too_few" ? 1 : 2);
  fields.sort((a, b) => rank(a) - rank(b) || (a.pct ?? 0) - (b.pct ?? 0) || a.field.localeCompare(b.field));
  const atMark = fields.filter((f) => f.state === "at_mark").length;
  const belowMark = fields.filter((f) => f.state === "below_mark").length;
  const tooFew = fields.filter((f) => f.state === "too_few").length;
  return {
    fields,
    minAnswered,
    measured: atMark + belowMark,
    atMark,
    belowMark,
    tooFew,
    allAtMark: fields.length > 0 && tooFew === 0 && belowMark === 0,
  };
}
