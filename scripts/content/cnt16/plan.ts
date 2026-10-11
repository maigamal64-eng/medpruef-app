import { createHash } from "node:crypto";
import { isStpFieldKey, requiresStpRowReview, stpFieldForTopic, stpFieldTag, type StpFieldKey } from "../../../src/lib/stp-fields";

export interface FieldRow {
  id: number;
  exam_type: string;
  is_active: boolean;
  topic: string;
  tags: string[] | null;
  question: string;
  answer: string;
  choices: unknown;
  explanation: string | null;
  source_file: string | null;
}
export interface RowReview { id: number; field: StpFieldKey; fingerprint: string; reason: string }
export interface FieldTarget { row: FieldRow; field: StpFieldKey; tag: string; afterTags: string[] }
export interface FieldGap { id: number; topic: string; field: StpFieldKey | null; reasons: string[] }
export interface Exclusions { openPicks: ReadonlyMap<number, string[]>; protectedIds: ReadonlySet<number>; survivors: ReadonlySet<number>; archiveRange: readonly [number, number] }

/** Reviewed content, not mutable metadata. Used both in planning and the SQL before-image guard. */
export function rowFingerprint(row: FieldRow): string {
  return createHash("sha256").update(JSON.stringify([row.topic, row.question, row.answer, row.choices, row.explanation])).digest("hex");
}

export function planFields(rows: readonly FieldRow[], exclusions: Exclusions, reviews: readonly RowReview[]) {
  const seen = new Set<number>();
  const reviewed = new Map<number, RowReview>();
  for (const review of reviews) {
    if (reviewed.has(review.id) || !isStpFieldKey(review.field) || !review.reason.trim()) throw new Error("Invalid or duplicate review");
    reviewed.set(review.id, review);
  }
  const targets: FieldTarget[] = [], gaps: FieldGap[] = [], alreadyTagged: number[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error("Invalid or duplicate row id");
    seen.add(row.id);
    if (row.exam_type !== "kmp_innsbruck" || !row.is_active) continue;
    if (row.tags !== null && (!Array.isArray(row.tags) || row.tags.some((t) => typeof t !== "string"))) throw new Error("Invalid tags");
    const reasons: string[] = [];
    if (exclusions.openPicks.has(row.id)) reasons.push(...exclusions.openPicks.get(row.id)!.map((pick) => `open-pick:${pick}`));
    if (exclusions.protectedIds.has(row.id)) reasons.push("protected-id");
    if (exclusions.survivors.has(row.id)) reasons.push("duplicate-survivor");
    if ((row.id >= exclusions.archiveRange[0] && row.id <= exclusions.archiveRange[1]) || row.source_file?.startsWith("ARCHIVE_ORIGINAL_")) reasons.push("archive");
    let field = stpFieldForTopic(row.topic);
    // Never make a per-row decision on an excluded row, even when a review file supplies one.
    if (reasons.length) { gaps.push({ id: row.id, topic: row.topic, field, reasons }); continue; }
    if (requiresStpRowReview(row.topic)) {
      const review = reviewed.get(row.id);
      if (!review) reasons.push("needs-row-review");
      else if (review.fingerprint !== rowFingerprint(row)) reasons.push("stale-row-review");
      else field = review.field;
    }
    if (!field && !reasons.length) reasons.push("unknown-topic");
    const fieldTags = (row.tags ?? []).filter((tag) => tag.startsWith("field:"));
    if (field && fieldTags.length === 1 && fieldTags[0] === stpFieldTag(field) && !reasons.length) { alreadyTagged.push(row.id); continue; }
    if (fieldTags.length) reasons.push("conflicting-field-tags");
    if (reasons.length || !field) { gaps.push({ id: row.id, topic: row.topic, field, reasons }); continue; }
    const tag = stpFieldTag(field);
    targets.push({ row, field, tag, afterTags: [...(row.tags ?? []), tag, ...((row.tags ?? []).includes("track-b-b21-2026-10") ? [] : ["track-b-b21-2026-10"])] });
  }
  if (targets.length > 2800) throw new Error("Package row cap exceeded");
  return { targets, gaps, alreadyTagged };
}
