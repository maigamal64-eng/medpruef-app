import { VIENNA_EXAM_PARTS } from "@/lib/topics";
import { SPT_FIELD_BLUEPRINT, type BlueprintEntry } from "./contracts";
import type { PassRuleId } from "./grading";

/**
 * Typed exam presets. The /exam page reads its blueprints, clocks and pass rules
 * from here (a24); the page holds no blueprint copy of its own.
 */

export type ExamPresetId = "kp_full" | "kp_sip4" | "kp_sip5" | "kmp_innsbruck_legacy" | "spt_250" | "rx_mc_30" | "kaf_timed";
export type QuestionShape = "mcq" | "open";

export interface ExamPreset {
  id: ExamPresetId;
  /** questions.exam_source / the stored exam source id. */
  examSource: string;
  /** exam-formats.data.json exam key the duration and rules come from. */
  formatExamKey: string;
  blueprint: BlueprintEntry[];
  /** Practice timer used when no official duration is read (see duration.ts). */
  practiceDurationS: number;
  /** null: no confirmed rule applies to this run, so the result shows the score only (labelled practice). */
  passRuleId: PassRuleId | null;
  shape: QuestionShape;
  ekgQuota: boolean;
  /** Pacing target in seconds per question (pick-exam-pace A: off by default in the drawer). */
  pacingTargetS: number;
  /** Shown to learners only when true. */
  enabled: boolean;
  /** Why a preset is off; track-A flips `enabled` only when this is resolved. */
  offReason: string | null;
  /** Rows must come from a reviewed pool (see pool.ts); empty pool blocks the start. */
  requiresReviewedPool: boolean;
  /** Extra tag filter applied to every blueprint line (any of these tags). */
  tagFilter?: string[];
  /** exam-formats.data.json rule ids that state the honest scope of this simulation. */
  scopeRuleIds: string[];
}

/** Current /exam practice timer (EXAM_DURATION_S): not a confirmed official duration (sip.duration, stp.duration). */
export const PRACTICE_DURATION_S = 4 * 60 * 60;
/** 1.5 minutes per question (pick-exam-pace A). */
export const DEFAULT_PACING_TARGET_S = 90;
export const EKG_QUOTA_TARGET = 3;

export const KP_BLUEPRINT: readonly BlueprintEntry[] = [
  { topic: "Innere Medizin", count: 28 },
  { topic: "Chirurgische Fächer", count: 28 },
  { topic: "Notfall- und Intensivmedizin", count: 20 },
  { topic: "Neurologie", count: 18 },
  { topic: "Frauenheilkunde/Gynäkologie", count: 18 },
  { topic: "Psychiatrie", count: 16 },
  { topic: "Dermatologie und Venerologie", count: 14 },
  { topic: "Kinder- und Jugendheilkunde", count: 14 },
  { topic: "Hals-Nasen-Ohrenheilkunde", count: 12 },
  { topic: "Augenheilkunde", count: 12 },
];

export const KMP_INNSBRUCK_BLUEPRINT: readonly BlueprintEntry[] = [
  { topic: "Neurologie", count: 20 },
  { topic: "Innere Medizin", count: 18 },
  { topic: "Psychiatrie", count: 16 },
  { topic: "Chirurgische Spezialfächer Und Anästhesie", count: 14 },
  { topic: "Augenheilkunde", count: 14 },
  { topic: "Allgemeine Chirurgie", count: 12 },
  { topic: "Frauenheilkunde/Gynäkologie", count: 12 },
  { topic: "Kinder Und Jugendheilkunde", count: 12 },
  { topic: "Dermatologie und Venerologie", count: 10 },
  { topic: "Hals-Nasen-Ohrenheilkunde", count: 10 },
  { topic: "Kinder Und Jugendpsychiatrie", count: 8 },
];

/** SPT 250 selects by the b21 field tags (field:<key>), never by legacy topic labels. */
export const SPT_250_BLUEPRINT: readonly BlueprintEntry[] = SPT_FIELD_BLUEPRINT.map((f) => ({
  topic: f.label.de,
  count: f.count,
  fieldTag: `field:${f.key}`,
}));

/** Rezeptierkunde MC curriculum blocks (SIM-05). */
export const RX_SIM_BLOCK_TAGS = ["block:9", "block:10", "block:11", "block:14", "block:15", "block:18", "block:19", "block:21"];

function part(part: "sip4" | "sip5"): BlueprintEntry[] {
  return KP_BLUEPRINT.filter((e) => VIENNA_EXAM_PARTS[part].includes(e.topic));
}

export const EXAM_PRESETS: Record<ExamPresetId, ExamPreset> = {
  kp_full: {
    id: "kp_full", examSource: "kenntnispruefung", formatExamKey: "sip4a",
    blueprint: [...KP_BLUEPRINT], practiceDurationS: PRACTICE_DURATION_S, passRuleId: "overall-60",
    shape: "mcq", ekgQuota: true, pacingTargetS: DEFAULT_PACING_TARGET_S,
    enabled: true, offReason: null, requiresReviewedPool: false, scopeRuleIds: ["sip.fidelity", "sip.duration"],
  },
  // SIP4a blocks 25, 26, 27 are exactly these three subjects (sip4a.assignment), so the block rule is checkable.
  kp_sip4: {
    id: "kp_sip4", examSource: "kenntnispruefung", formatExamKey: "sip4a",
    blueprint: part("sip4"), practiceDurationS: PRACTICE_DURATION_S, passRuleId: "sip-overall-and-blocks-60",
    shape: "mcq", ekgQuota: true, pacingTargetS: DEFAULT_PACING_TARGET_S,
    enabled: true, offReason: null, requiresReviewedPool: false, scopeRuleIds: ["sip.fidelity", "sip.pass", "sip.duration"],
  },
  // SIP5a block grouping of the seven subjects is not in the data file, so the overall rule stays.
  kp_sip5: {
    id: "kp_sip5", examSource: "kenntnispruefung", formatExamKey: "sip5a",
    blueprint: part("sip5"), practiceDurationS: PRACTICE_DURATION_S, passRuleId: "overall-60",
    shape: "mcq", ekgQuota: false, pacingTargetS: DEFAULT_PACING_TARGET_S,
    enabled: true, offReason: null, requiresReviewedPool: false, scopeRuleIds: ["sip.fidelity", "sip.duration"],
  },
  // The legacy topics are not the ten official fields, so the six-of-ten rule cannot be
  // applied and no threshold is shown (UX-EXM-17): score only, labelled practice.
  kmp_innsbruck_legacy: {
    id: "kmp_innsbruck_legacy", examSource: "kmp_innsbruck", formatExamKey: "stichprobentest",
    blueprint: [...KMP_INNSBRUCK_BLUEPRINT], practiceDurationS: PRACTICE_DURATION_S, passRuleId: null,
    shape: "mcq", ekgQuota: false, pacingTargetS: DEFAULT_PACING_TARGET_S,
    enabled: true, offReason: null, requiresReviewedPool: false, scopeRuleIds: ["stp.fidelity", "stp.duration"],
  },
  // pick-spt-bank A + pick-spt-duration A: built, OFF until Lektor reads the current duration
  // document and the b21 field tags (with Medic-reviewed Notfall rows) are applied.
  spt_250: {
    id: "spt_250", examSource: "kmp_innsbruck", formatExamKey: "stichprobentest",
    blueprint: [...SPT_250_BLUEPRINT], practiceDurationS: PRACTICE_DURATION_S, passRuleId: "stp-six-fields-60",
    shape: "mcq", ekgQuota: false, pacingTargetS: DEFAULT_PACING_TARGET_S,
    enabled: false,
    offReason: "pick-spt-duration A: stays off until the current official duration is read (FMT-05) and b21 field tags are applied",
    requiresReviewedPool: false, scopeRuleIds: ["stp.structure", "stp.pass", "stp.fidelity", "stp.duration"],
  },
  // SIM-05 / pick-pharma-conversion A: 30 one-best-answer items, 60 minutes, curriculum
  // blocks 9, 10, 11, 14, 15, 18, 19 and 21. No pass mark (rx.pass not confirmed). The page
  // checks availability live (canStartPreset); it lights up once b26's MC rows are applied.
  rx_mc_30: {
    id: "rx_mc_30", examSource: "pharma", formatExamKey: "rezeptierkunde",
    blueprint: [{ topic: "Pharmakologie", count: 30 }], practiceDurationS: 60 * 60, passRuleId: null,
    shape: "mcq", ekgQuota: false, pacingTargetS: 120,
    enabled: true, offReason: null, requiresReviewedPool: false,
    tagFilter: RX_SIM_BLOCK_TAGS, scopeRuleIds: ["rx.format", "rx.pass"],
  },
  // pick-kaf-pool build: timed KAF mode over the two-read Medic pool only; empty pool blocks the start.
  kaf_timed: {
    id: "kaf_timed", examSource: "kenntnispruefung", formatExamKey: "sip4a",
    blueprint: [], practiceDurationS: PRACTICE_DURATION_S, passRuleId: "overall-60",
    shape: "open", ekgQuota: false, pacingTargetS: DEFAULT_PACING_TARGET_S,
    enabled: true, offReason: null, requiresReviewedPool: true, scopeRuleIds: ["sip.kaf", "sip.fidelity", "sip.duration"],
  },
};

export function getExamPreset(id: string): ExamPreset | undefined {
  return Object.hasOwn(EXAM_PRESETS, id) ? EXAM_PRESETS[id as ExamPresetId] : undefined;
}

export function blueprintTotal(blueprint: readonly BlueprintEntry[]): number {
  return blueprint.reduce((sum, e) => sum + e.count, 0);
}

/** Presets a learner may start for an exam source; disabled presets never leak. */
export function enabledPresetsFor(examSource: string): ExamPreset[] {
  return Object.values(EXAM_PRESETS).filter((p) => p.enabled && p.examSource === examSource);
}
