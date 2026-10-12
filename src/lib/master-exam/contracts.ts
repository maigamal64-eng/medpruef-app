/**
 * Pure exam engine contracts (b34-exam-pure, wired by a24). No UI, no Supabase, no React.
 * Sitting formats come from src/lib/exam-formats.ts (b07); the Stichprobentest fields
 * from src/lib/stp-fields.ts (b21).
 */
import type { SittingFormat } from "@/lib/exam-formats";
import { STP_FIELDS, STP_FIELD_SOURCE } from "@/lib/stp-fields";

export type ExamLanguage = "de" | "en";
export type FactStatus = "official" | "reported" | "not_confirmed";

/** The b07 SittingFormat fields duration resolution reads. Pass EXAM_FORMAT_DATA.sittings directly. */
export type SittingDurationRecord = Pick<SittingFormat, "examKey" | "date" | "status" | "sourceId" | "durationMin">;

/** One blueprint line. `topic` matches questions.topic exactly; `fieldTag` selects by tag instead. */
export interface BlueprintEntry {
  topic: string;
  count: number;
  fieldTag?: string;
}

/** Bank row shape the pure engine needs. Option order is the order shown to the learner. */
export interface GradableQuestion {
  id: number | string;
  topic: string;
  options?: { text: string; correct: boolean }[];
  /** Open-answer (KAF) rows: every accepted wording of each required answer. */
  acceptedAnswers?: string[][];
}

export const SPT_FIELD_SOURCE = STP_FIELD_SOURCE;

/** The ten official Stichprobentest fields and their question counts (sum 250), owned by src/lib/stp-fields.ts. */
export const SPT_FIELD_BLUEPRINT: readonly { key: string; label: Record<ExamLanguage, string>; count: number }[] =
  STP_FIELDS.map((f) => ({ key: f.key, label: f.label, count: f.questionCount }));
