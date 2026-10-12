import type { GradableQuestion } from "./contracts";

/**
 * All-or-nothing grading (sip.mc, stp.fidelity): the complete correct selection
 * earns the point, anything else earns zero. There is no partial credit
 * (pick-partial-credit A: no official source defines one).
 */

export type Answer = { indices: number[] } | { texts: string[] };

export interface GradeResult {
  correct: boolean;
  answered: boolean;
}

export function normalizeAnswerText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("de-AT")
    .replace(/ß/g, "ss")
    .replace(/[­​]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function correctIndexSet(q: GradableQuestion): Set<number> {
  const set = new Set<number>();
  (q.options ?? []).forEach((o, i) => { if (o.correct) set.add(i); });
  return set;
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Map chosen option texts back to indices; an unknown or ambiguous text makes the answer wrong. */
function indicesFromTexts(q: GradableQuestion, texts: string[]): Set<number> | null {
  const options = (q.options ?? []).map((o) => normalizeAnswerText(o.text));
  const out = new Set<number>();
  for (const text of texts) {
    const key = normalizeAnswerText(text);
    const hits = options.flatMap((o, i) => (o === key ? [i] : []));
    if (hits.length !== 1) return null;
    out.add(hits[0]);
  }
  return out;
}

/** KAF: every required answer must be matched by a distinct learner answer; extra answers do not score. */
function gradeOpenAnswer(q: GradableQuestion, texts: string[]): boolean {
  const required = q.acceptedAnswers ?? [];
  if (required.length === 0) return false;
  const given = texts.map(normalizeAnswerText).filter(Boolean);
  if (given.length < required.length) return false;
  const used = new Set<number>();
  for (const alternatives of required) {
    const accepted = new Set(alternatives.map(normalizeAnswerText));
    const hit = given.findIndex((g, i) => !used.has(i) && accepted.has(g));
    if (hit < 0) return false;
    used.add(hit);
  }
  return true;
}

export function gradeQuestion(q: GradableQuestion, answer: Answer | undefined): GradeResult {
  if (!answer) return { correct: false, answered: false };
  if ("indices" in answer) {
    const chosen = new Set(answer.indices);
    if (chosen.size === 0) return { correct: false, answered: false };
    const key = correctIndexSet(q);
    return { correct: key.size > 0 && sameSet(chosen, key), answered: true };
  }
  const texts = answer.texts.filter((t) => normalizeAnswerText(t) !== "");
  if (texts.length === 0) return { correct: false, answered: false };
  if (q.acceptedAnswers) return { correct: gradeOpenAnswer(q, texts), answered: true };
  const chosen = indicesFromTexts(q, texts);
  const key = correctIndexSet(q);
  return { correct: chosen !== null && key.size > 0 && sameSet(chosen, key), answered: true };
}

export interface SubjectResult {
  topic: string;
  total: number;
  answered: number;
  correct: number;
  pct: number;
  /** Seconds spent on this subject's questions divided by its question count; null without timings. */
  avgSecondsPerQuestion: number | null;
}

/**
 * Per-subject aggregation in first-seen order. `secondsByIndex` holds time spent per
 * question index (from the pacing tracker); the results screen shows the average per subject.
 */
export function aggregateBySubject(
  questions: readonly GradableQuestion[],
  answers: Readonly<Record<number, Answer | undefined>>,
  secondsByIndex?: Readonly<Record<number, number>>,
  subjectOf: (q: GradableQuestion) => string = (q) => q.topic || "Sonstige",
): SubjectResult[] {
  const map = new Map<string, { total: number; answered: number; correct: number; seconds: number; timed: boolean }>();
  questions.forEach((q, idx) => {
    const key = subjectOf(q);
    const row = map.get(key) ?? { total: 0, answered: 0, correct: 0, seconds: 0, timed: false };
    const grade = gradeQuestion(q, answers[idx]);
    row.total += 1;
    if (grade.answered) row.answered += 1;
    if (grade.correct) row.correct += 1;
    const s = secondsByIndex?.[idx];
    if (typeof s === "number" && Number.isFinite(s) && s >= 0) { row.seconds += s; row.timed = true; }
    map.set(key, row);
  });
  return [...map.entries()].map(([topic, r]) => ({
    topic,
    total: r.total,
    answered: r.answered,
    correct: r.correct,
    pct: r.total > 0 ? r.correct / r.total : 0,
    avgSecondsPerQuestion: r.timed ? r.seconds / r.total : null,
  }));
}

export type PassRuleId = "overall-60" | "sip-overall-and-blocks-60" | "stp-six-fields-60";

export interface PassRule {
  id: PassRuleId;
  /** Fraction each unit must reach. */
  threshold: number;
  /** Rule source id in exam-formats.data.json (b07), or null for the legacy practice rule. */
  ruleSourceId: string | null;
}

export const PASS_RULES: Record<PassRuleId, PassRule> = {
  // Legacy practice rule the /exam page uses today (PASS_THRESHOLD = 0.6 overall).
  "overall-60": { id: "overall-60", threshold: 0.6, ruleSourceId: null },
  // sip.pass: at least 60 percent overall and in each block or tertial.
  "sip-overall-and-blocks-60": { id: "sip-overall-and-blocks-60", threshold: 0.6, ruleSourceId: "sip.pass" },
  // stp.pass: a field is positive at 60 percent; six or more positive fields.
  "stp-six-fields-60": { id: "stp-six-fields-60", threshold: 0.6, ruleSourceId: "stp.pass" },
};

export const STP_POSITIVE_FIELDS_REQUIRED = 6;

export interface PassEvaluation {
  ruleId: PassRuleId;
  passed: boolean;
  overallPct: number;
  correct: number;
  total: number;
  /** Subjects (blocks or fields) at or above the threshold. */
  positiveUnits: string[];
  /** Subjects below the threshold. */
  negativeUnits: string[];
}

/** Integer comparison avoids 0.6 float drift: correct * 10 >= total * 6. */
function meets(correct: number, total: number, threshold: number): boolean {
  if (total <= 0) return false;
  const scale = 1000;
  return correct * scale >= Math.round(threshold * scale) * total;
}

export function evaluatePassRule(ruleId: PassRuleId, subjects: readonly SubjectResult[]): PassEvaluation {
  const rule = PASS_RULES[ruleId];
  const correct = subjects.reduce((s, r) => s + r.correct, 0);
  const total = subjects.reduce((s, r) => s + r.total, 0);
  const positiveUnits = subjects.filter((r) => meets(r.correct, r.total, rule.threshold)).map((r) => r.topic);
  const negativeUnits = subjects.filter((r) => !meets(r.correct, r.total, rule.threshold)).map((r) => r.topic);
  const overall = meets(correct, total, rule.threshold);
  let passed: boolean;
  if (ruleId === "overall-60") passed = overall;
  else if (ruleId === "sip-overall-and-blocks-60") passed = overall && negativeUnits.length === 0 && subjects.length > 0;
  else passed = positiveUnits.length >= STP_POSITIVE_FIELDS_REQUIRED;
  return { ruleId, passed, overallPct: total > 0 ? correct / total : 0, correct, total, positiveUnits, negativeUnits };
}
