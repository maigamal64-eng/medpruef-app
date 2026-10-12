import type { BlueprintEntry, GradableQuestion } from "./contracts";
import type { ExamPreset } from "./presets";

/**
 * Pool guards. KAF (pick-kaf-pool build) runs only on rows that passed both Medic
 * reads in the kaf-triage job; the reviewed pool is passed in by the caller (track-A
 * loads it server side). An empty or missing pool blocks the start.
 */

/** One Medic read of a KAF row (subset of R/data/kaf-triage/pool.json). */
export interface KafRead {
  verdict: string;
  model_answer: string;
  key_points: string[];
  /** "yes" when the read confirms the stored key, "no" when it corrects it. */
  key_correct?: string;
}

/** One reviewed KAF row (subset of R/data/kaf-triage/pool.json rows). */
export interface ReviewedKafRow {
  id: number;
  topic: string;
  stored_answer: string;
  /** True when the reads asked for a stem cleanup before the row may be shown. */
  stem_fix_needed?: boolean;
  read1: KafRead;
  read2: KafRead;
}

const INCLUDE = new Set(["include", "fix-then-include"]);

/** pool.json rule: both reads include or fix-then-include AND agree on key correctness. */
export function isTwoReadPass(row: ReviewedKafRow): boolean {
  return INCLUDE.has(row.read1.verdict) && INCLUDE.has(row.read2.verdict) && row.read1.key_correct === row.read2.key_correct;
}

/** The stored wording counts only when no read says the stored key is wrong. */
function storedKeyConfirmed(row: ReviewedKafRow): boolean {
  return row.read1.key_correct !== "no" && row.read2.key_correct !== "no";
}

/**
 * One required answer, accepted in either read's model answer or key points, plus the
 * stored wording when both reads confirm it. Key points are accepted as full answers;
 * track-A may narrow this to model answers only.
 */
export function kafAcceptedAnswers(row: ReviewedKafRow): string[][] {
  const alternatives = [
    ...(storedKeyConfirmed(row) ? [row.stored_answer] : []),
    row.read1.model_answer,
    row.read2.model_answer,
    ...row.read1.key_points,
    ...row.read2.key_points,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return [[...new Set(alternatives)]];
}

export interface KafPoolOptions {
  /** Whether the stem cleanup for a row has been applied in the bank; rows needing one stay out until then. */
  stemFixApplied?: (id: number) => boolean;
}

export function kafQuestionsFromPool(rows: readonly ReviewedKafRow[], options: KafPoolOptions = {}): GradableQuestion[] {
  const fixed = options.stemFixApplied ?? (() => false);
  return rows
    .filter((row) => isTwoReadPass(row) && (!row.stem_fix_needed || fixed(row.id)))
    .map((row) => ({ id: row.id, topic: row.topic, acceptedAnswers: kafAcceptedAnswers(row) }));
}

/** Required item shape for a preset: displayed options and correct options per item. */
export interface ItemShape {
  options: number;
  correct: number;
}

/** A served question (attachOptions output): options are the displayed choices. */
export interface ShapedQuestion {
  options?: readonly { correct?: boolean }[] | null;
}

/**
 * Whether a served question has exactly the preset's shape. Open-answer rows
 * (options null) and rows whose displayed options differ never match.
 */
export function matchesItemShape(question: ShapedQuestion, shape: ItemShape): boolean {
  const options = question.options;
  if (!Array.isArray(options) || options.length !== shape.options) return false;
  return options.filter((o) => o?.correct === true).length === shape.correct;
}

export type StartCheck =
  | { ok: true; questionCount: number }
  | { ok: false; reason: "preset_disabled" | "empty_pool" | "short_blueprint"; detail: string };

/**
 * Whether a preset may start. `available` is the count of eligible rows per blueprint line
 * (keyed by fieldTag when set, else topic) or, for pool presets, the reviewed pool size.
 */
export function canStartPreset(preset: ExamPreset, available: Readonly<Record<string, number>> | number): StartCheck {
  if (!preset.enabled) return { ok: false, reason: "preset_disabled", detail: preset.offReason ?? "disabled" };
  if (preset.requiresReviewedPool) {
    const n = typeof available === "number" ? available : 0;
    return n > 0 ? { ok: true, questionCount: n } : { ok: false, reason: "empty_pool", detail: "no reviewed rows" };
  }
  const counts = typeof available === "number" ? {} : available;
  const short = preset.blueprint.filter((e: BlueprintEntry) => (counts[e.fieldTag ?? e.topic] ?? 0) < e.count);
  if (short.length > 0) {
    return { ok: false, reason: "short_blueprint", detail: short.map((e) => `${e.fieldTag ?? e.topic}`).join(", ") };
  }
  return { ok: true, questionCount: preset.blueprint.reduce((s, e) => s + e.count, 0) };
}
