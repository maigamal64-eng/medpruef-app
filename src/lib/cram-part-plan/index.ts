/**
 * Part-aware cram plan (a-cram-part-plan). Pure: no React, no fetch.
 *
 * November sitters are on the Vienna SIP route (SIP5a and SIP4a on separate
 * days). A learner whose saved exam date is exactly one SIP4a or one SIP5a
 * row of OFFICIAL_SITTINGS gets a plan over that part's subjects only,
 * weighted by the preset blueprint (a MedPrüf practice blueprint, never an
 * official weighting), with timed part runs (kp_sip4 / kp_sip5) and a drill
 * day after each run on the subjects that run left below 60 percent.
 *
 * Same-date rows (SIP4a and SIP5a on one day) and window_unconfirmed rows
 * keep today's all-subject plan and the full run (kp_full). Plans of 30 days
 * or more keep their simulation days (plan-simulations.ts); plans of 10 to
 * 29 days get T-14 and T-7 when both fit, else T-7.
 */
import { EXAM_PRESETS, type ExamPresetId } from "@/lib/master-exam";
import { VIENNA_EXAM_PARTS } from "@/lib/topics";
import { resolveNamedSitting, isoDayOf } from "@/lib/journey/moments";
import { OFFICIAL_SITTINGS, viennaToday, type OfficialSitting } from "@/lib/exam-dates";

export type CramPart = "sip4" | "sip5";
export type CramPresetId = Extract<ExamPresetId, "kp_sip4" | "kp_sip5">;
export type CramExamKey = "sip4a" | "sip5a";

export const CRAM_PRESET: Record<CramPart, CramPresetId> = { sip4: "kp_sip4", sip5: "kp_sip5" };
export const CRAM_EXAM_KEY: Record<CramPart, CramExamKey> = { sip4: "sip4a", sip5: "sip5a" };
export const PART_OF_PRESET: Record<CramPresetId, CramPart> = { kp_sip4: "sip4", kp_sip5: "sip5" };
export const CRAM_PRESET_IDS: readonly CramPresetId[] = ["kp_sip4", "kp_sip5"];

export { DRILL_BELOW, DRILL_RUN_WINDOW_DAYS, drillRunFor, type PartRunSummary } from "@/lib/master-learning/plan-drill";
import { DRILL_BELOW, type PartRunSummary } from "@/lib/master-learning/plan-drill";

export function isCramPresetId(v: unknown): v is CramPresetId {
  return v === "kp_sip4" || v === "kp_sip5";
}

export interface CramResolution {
  part: CramPart;
  presetId: CramPresetId;
  examKey: CramExamKey;
  /** The sitting date (ISO). */
  date: string;
}

/**
 * The SIP part of the learner's saved sitting, or null (today's all-subject
 * plan). Only an own, future exam date that names exactly one SIP4a or one
 * SIP5a row of the Kenntnisprüfung bank, with a confirmed window, counts.
 */
export function resolveCramPart(
  input: { examDate: string | null | undefined; activeExam: string | null | undefined },
  now: Date,
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): CramResolution | null {
  if (input.activeExam !== "kenntnispruefung") return null;
  const day = isoDayOf(input.examDate ?? null);
  if (!day) return null;
  const named = resolveNamedSitting({ examDate: day, activeExam: input.activeExam }, now, sittings);
  if (!named || named.bank !== "kenntnispruefung") return null;
  if (named.exam_keys.length !== 1) return null;
  if (named.rows.length === 0 || named.rows.some((r) => r.window_unconfirmed === true)) return null;
  if (named.date <= viennaToday(now)) return null;
  const key = named.exam_keys[0];
  const part: CramPart | null = key === "sip4a" ? "sip4" : key === "sip5a" ? "sip5" : null;
  if (!part) return null;
  return { part, presetId: CRAM_PRESET[part], examKey: CRAM_EXAM_KEY[part], date: named.date };
}

/** Subjects of a part, in VIENNA_EXAM_PARTS order. */
export function partTopics(part: CramPart): readonly string[] {
  return VIENNA_EXAM_PARTS[part];
}

/** Keep only the part's subjects. */
export function filterPartTopics<T extends { topic: string }>(topics: readonly T[], part: CramPart): T[] {
  const keep = new Set(VIENNA_EXAM_PARTS[part]);
  return topics.filter((t) => keep.has(t.topic));
}

/**
 * Relative weight per subject from the part preset's blueprint counts, mean
 * 1 (a MedPrüf practice blueprint, never official weights).
 */
export function partBlueprintWeights(part: CramPart): Record<string, number> {
  const bp = EXAM_PRESETS[CRAM_PRESET[part]].blueprint;
  const mean = bp.reduce((s, e) => s + e.count, 0) / Math.max(1, bp.length);
  const out: Record<string, number> = {};
  for (const e of bp) out[e.topic] = mean > 0 ? e.count / mean : 1;
  return out;
}

export { cramSimulationOffsets, CRAM_MIN_DAYS, CRAM_OFFSETS } from "@/lib/master-learning/plan-simulations";

// ── Runs and drill days ──

export interface PartRunSubject {
  topic: string;
  correct: number;
  total: number;
}

/**
 * Subjects of one run below the 60 percent mark, weakest first. Only the
 * part's subjects; a subject with no question in the run is left out.
 */
export function runWeakSubjects(subjects: readonly PartRunSubject[], part: CramPart): Array<{ topic: string; pct: number }> {
  const keep = new Set(VIENNA_EXAM_PARTS[part]);
  return subjects
    .filter((s) => keep.has(s.topic) && s.total > 0 && s.correct / s.total < DRILL_BELOW)
    .map((s) => ({ topic: s.topic, pct: s.correct / s.total }))
    .sort((a, b) => a.pct - b.pct || a.topic.localeCompare(b.topic));
}

/** Per-subject counts of one stored run (grading snapshot plus the topics read at read time). */
export function runSubjects(
  questionIds: readonly number[],
  grading: Record<string, { is_correct?: unknown } | undefined> | null,
  topicById: ReadonlyMap<number, string>,
): PartRunSubject[] {
  const by = new Map<string, PartRunSubject>();
  for (const id of questionIds) {
    const topic = topicById.get(id);
    if (!topic) continue; // removed question: left out
    const s = by.get(topic) ?? { topic, correct: 0, total: 0 };
    s.total += 1;
    if (grading?.[String(id)]?.is_correct === true) s.correct += 1;
    by.set(topic, s);
  }
  return [...by.values()];
}

/** The newest run of any part preset, or null. */
export function latestPartRun(runs: readonly PartRunSummary[]): PartRunSummary | null {
  let best: PartRunSummary | null = null;
  for (const r of runs) if (!best || r.day > best.day) best = r;
  return best;
}

// ── Event buckets ──

export type CramDaysBucket = "lt10" | "d10_13" | "d14_20" | "d21_29" | "d30plus";

export function cramDaysBucket(days: number): CramDaysBucket {
  if (days < 10) return "lt10";
  if (days < 14) return "d10_13";
  if (days < 21) return "d14_20";
  if (days < 30) return "d21_29";
  return "d30plus";
}

export const CRAM_PLAN_VIEW_EVENT = "cram_plan_view";
export const PLAN_SIMULATION_START_EVENT = "plan_simulation_start";

// ── Client view of the study-plan response ──

export type CramView =
  | { part: "all"; days: CramDaysBucket }
  | {
      part: CramPart;
      presetId: CramPresetId;
      examKey: CramExamKey;
      date: string;
      days: CramDaysBucket;
      /** Timed KAF practice is live (KAF_TIMED_ENABLED, path.json kaf-timed) and the part is SIP4a. */
      kaf: boolean;
      /** The newest run of this part in the last 30 days (paid callers only), with its subjects below 60 percent. */
      latestRun: { day: string; weak: string[] } | null;
    };

const BUCKETS: readonly CramDaysBucket[] = ["lt10", "d10_13", "d14_20", "d21_29", "d30plus"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The response's cram block, or null (flag off, or a shape this client does not know). */
export function parseCramView(v: unknown): CramView | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (!BUCKETS.includes(c.days as CramDaysBucket)) return null;
  const days = c.days as CramDaysBucket;
  if (c.part === "all") return { part: "all", days };
  if (c.part !== "sip4" && c.part !== "sip5") return null;
  const part = c.part;
  if (c.presetId !== CRAM_PRESET[part] || c.examKey !== CRAM_EXAM_KEY[part]) return null;
  if (typeof c.date !== "string" || !ISO.test(c.date)) return null;
  let latestRun: { day: string; weak: string[] } | null = null;
  const lr = c.latestRun as Record<string, unknown> | null | undefined;
  if (lr && typeof lr === "object" && typeof lr.day === "string" && ISO.test(lr.day) && Array.isArray(lr.weak)) {
    latestRun = { day: lr.day, weak: lr.weak.filter((x): x is string => typeof x === "string" && VIENNA_EXAM_PARTS[part].includes(x)) };
  }
  return { part, presetId: CRAM_PRESET[part], examKey: CRAM_EXAM_KEY[part], date: c.date, days, kaf: c.kaf === true, latestRun };
}
