import type { BlueprintEntry, GradableQuestion } from "./contracts";
import type { ExamPreset } from "./presets";

/**
 * Pool guards. KAF (pick-kaf-pool build) runs only on rows that passed both Medic
 * reads in the kaf-triage job; the reviewed pool is passed in by the caller (track-A
 * loads it server side). An empty or missing pool blocks the start.
 */

/** One reviewed KAF row (subset of R/data/kaf-triage/pool.json rows). */
export interface ReviewedKafRow {
  id: number;
  topic: string;
  stored_answer: string;
  read1: { verdict: string; model_answer: string; key_points: string[] };
  read2: { verdict: string; model_answer: string; key_points: string[] };
}

const INCLUDE = new Set(["include", "fix-then-include"]);

export function isTwoReadPass(row: ReviewedKafRow): boolean {
  return INCLUDE.has(row.read1.verdict) && INCLUDE.has(row.read2.verdict);
}

/** One required answer, accepted in the stored wording or either read's model answer or key points. */
export function kafAcceptedAnswers(row: ReviewedKafRow): string[][] {
  const alternatives = [row.stored_answer, row.read1.model_answer, row.read2.model_answer, ...row.read1.key_points, ...row.read2.key_points]
    .map((s) => s.trim())
    .filter(Boolean);
  return [[...new Set(alternatives)]];
}

export function kafQuestionsFromPool(rows: readonly ReviewedKafRow[]): GradableQuestion[] {
  return rows.filter(isTwoReadPass).map((row) => ({ id: row.id, topic: row.topic, acceptedAnswers: kafAcceptedAnswers(row) }));
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
