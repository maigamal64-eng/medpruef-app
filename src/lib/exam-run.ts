/**
 * exam-run: pure helpers that turn the /exam choices (source, part, owed
 * subjects, custom size) into a run plan, and a finished run into a verdict.
 * The engine lives in src/lib/master-exam (b34); formats and rule sources in
 * src/lib/exam-formats (b07). No React, no fetch.
 */
import {
  EXAM_PRESETS,
  PASS_RULES,
  DEFAULT_PACING_TARGET_S,
  PRACTICE_DURATION_S,
  aggregateBySubject,
  blueprintTotal,
  evaluatePassRule,
  gradeQuestion,
  resolveDuration,
  type Answer,
  type BlueprintEntry,
  type ExamPreset,
  type ExamPresetId,
  type GradableQuestion,
  type PassEvaluation,
  type PassRuleId,
  type SubjectResult,
} from "@/lib/master-exam";
import { EXAM_FORMAT_DATA, upcomingFormatCards, type FactStatus, type SittingFormat } from "@/lib/exam-formats";

export type ExamPart = "all" | "sip4" | "sip5" | "custom";

const SOURCE_PARTS: Record<string, ExamPart[]> = {
  kenntnispruefung: ["all", "sip4", "sip5", "custom"],
  kmp_innsbruck: ["all", "custom"],
  pharma: ["all", "custom"],
};

const PART_PRESET: Record<string, Partial<Record<ExamPart, ExamPresetId>>> = {
  kenntnispruefung: { all: "kp_full", sip4: "kp_sip4", sip5: "kp_sip5" },
  kmp_innsbruck: { all: "kmp_innsbruck_legacy" },
  pharma: { all: "rx_mc_30" },
};

/** Parts a learner may pick for a bank (UX-EXM-26: custom for every MCQ source). */
export function partsForSource(examSource: string): ExamPart[] {
  return SOURCE_PARTS[examSource] ?? ["all", "custom"];
}

/** An invalid ?part= value for the bank falls back to the full run. */
export function normalizePart(examSource: string, raw: string | null | undefined): ExamPart {
  const parts = partsForSource(examSource);
  return parts.includes(raw as ExamPart) ? (raw as ExamPart) : "all";
}

export function presetForRun(examSource: string, part: ExamPart): ExamPreset | null {
  const id = PART_PRESET[examSource]?.[part];
  const preset = id ? EXAM_PRESETS[id] : undefined;
  return preset && preset.enabled ? preset : null;
}

/** Custom runs: 1.5 minutes per question, at least 10 minutes, never above the full run. */
export function customDurationS(count: number): number {
  if (count <= 0) return 0;
  return Math.min(PRACTICE_DURATION_S, Math.max(600, count * DEFAULT_PACING_TARGET_S));
}

/** Untimed practice is offered only for small custom runs (UX-EXM-17). */
export const UNTIMED_MAX_QUESTIONS = 49;

export interface RunPlan {
  presetId: ExamPresetId | null;
  part: ExamPart;
  blueprint: BlueprintEntry[];
  total: number;
  durationS: number;
  durationKind: "official" | "practice";
  untimed: boolean;
  passRuleId: PassRuleId | null;
  tagsAny: string[] | null;
  ekgQuota: boolean;
  pacingTargetS: number;
}

export interface PlanInput {
  examSource: string;
  part: ExamPart;
  /** Subjects the learner still owes (SIM-03); empty or missing means all. */
  owed?: readonly string[];
  /** Custom runs: requested size and whether to run without a clock. */
  customCount?: number;
  untimed?: boolean;
  /** Next sitting date, used only when the format data records an official duration. */
  sittingDate?: string;
}

export function planRun(input: PlanInput): RunPlan {
  const preset = input.part === "custom" ? null : presetForRun(input.examSource, input.part);
  if (!preset) {
    const count = Math.max(0, input.customCount ?? 0);
    const untimed = !!input.untimed && count > 0 && count <= UNTIMED_MAX_QUESTIONS;
    return {
      presetId: null, part: "custom", blueprint: [], total: count,
      durationS: untimed ? 0 : customDurationS(count), durationKind: "practice", untimed,
      passRuleId: null, tagsAny: null, ekgQuota: false, pacingTargetS: DEFAULT_PACING_TARGET_S,
    };
  }
  const owed = input.owed && input.owed.length > 0 ? new Set(input.owed) : null;
  const blueprint = owed ? preset.blueprint.filter((e) => owed.has(e.topic)) : [...preset.blueprint];
  const full = owed === null || blueprint.length === preset.blueprint.length;
  const duration = resolveDuration(preset, EXAM_FORMAT_DATA.sittings, input.sittingDate);
  return {
    presetId: preset.id,
    part: input.part,
    blueprint,
    total: blueprintTotal(blueprint),
    // A subset keeps the full practice clock until official per-part durations are read
    // (UX-EXM-17: part runs keep their current length, no derived rate).
    durationS: duration.seconds,
    durationKind: duration.kind,
    untimed: false,
    passRuleId: preset.passRuleId,
    tagsAny: preset.tagFilter ?? null,
    // The ECG quota needs the full SIP4 internal-medicine block.
    ekgQuota: preset.ekgQuota && (full || blueprint.some((e) => e.topic === "Innere Medizin")),
    pacingTargetS: preset.pacingTargetS,
  };
}

export type VerdictKind = "practice" | "threshold" | "blocks" | "fields";

export interface RunVerdict {
  kind: VerdictKind;
  evaluation: PassEvaluation | null;
  /** Status of the rule source in the format data; null for the practice threshold. */
  ruleStatus: FactStatus | null;
  ruleSourceId: string | null;
  thresholdPct: number;
}

export function ruleStatusFor(sourceId: string | null): FactStatus | null {
  if (!sourceId) return null;
  return EXAM_FORMAT_DATA.rules.find((r) => r.id === sourceId)?.status ?? "not_confirmed";
}

export function runVerdict(passRuleId: PassRuleId | null | undefined, subjects: readonly SubjectResult[]): RunVerdict {
  if (!passRuleId || !Object.hasOwn(PASS_RULES, passRuleId)) {
    return { kind: "practice", evaluation: null, ruleStatus: null, ruleSourceId: null, thresholdPct: 60 };
  }
  const rule = PASS_RULES[passRuleId];
  const evaluation = evaluatePassRule(passRuleId, subjects);
  const kind: VerdictKind = passRuleId === "overall-60" ? "threshold" : passRuleId === "stp-six-fields-60" ? "fields" : "blocks";
  return { kind, evaluation, ruleStatus: ruleStatusFor(rule.ruleSourceId), ruleSourceId: rule.ruleSourceId, thresholdPct: Math.round(rule.threshold * 100) };
}

/** Page question shape: options in display order with the correct flags. */
export interface RunQuestion {
  id: number;
  topic: string;
  options?: { text: string; correct: boolean }[];
}

export type RunAnswers = Readonly<Record<number, number[] | undefined>>;

function toAnswers(answers: RunAnswers): Record<number, Answer | undefined> {
  const out: Record<number, Answer | undefined> = {};
  for (const [k, v] of Object.entries(answers)) if (Array.isArray(v)) out[Number(k)] = { indices: v };
  return out;
}

export function gradeAt(question: RunQuestion | undefined, selected: number[] | undefined) {
  if (!question) return { correct: false, answered: false };
  return gradeQuestion(question as GradableQuestion, selected ? { indices: selected } : undefined);
}

/** Subjects in first-seen order with average seconds per question when dwell times exist. */
export function subjectResults(questions: readonly RunQuestion[], answers: RunAnswers, secondsByIndex?: Record<number, number>): SubjectResult[] {
  return aggregateBySubject(questions as GradableQuestion[], toAnswers(answers), secondsByIndex);
}

export interface RunCounts {
  total: number;
  correct: number;
  wrong: number;
  open: number;
  flagged: number;
}

export function runCounts(questions: readonly RunQuestion[], answers: RunAnswers, flagged: ReadonlySet<number>): RunCounts {
  let correct = 0;
  let wrong = 0;
  questions.forEach((q, i) => {
    const g = gradeAt(q, answers[i]);
    if (g.correct) correct += 1;
    else if (g.answered) wrong += 1;
  });
  return { total: questions.length, correct, wrong, open: questions.length - correct - wrong, flagged: flagged.size };
}

export type ReviewFilter = "wrong" | "open" | "flagged" | "all";

export function reviewIndices(filter: ReviewFilter, questions: readonly RunQuestion[], answers: RunAnswers, flagged: ReadonlySet<number>, topic?: string | null): number[] {
  const out: number[] = [];
  questions.forEach((q, i) => {
    if (topic && (q.topic || "Sonstige") !== topic) return;
    const g = gradeAt(q, answers[i]);
    const keep = filter === "all" || (filter === "wrong" && g.answered && !g.correct) || (filter === "open" && !g.answered) || (filter === "flagged" && flagged.has(i));
    if (keep) out.push(i);
  });
  return out;
}

/** Question ids of wrong and unanswered items, in exam order, without duplicates (UX-EXM-30). */
export function missedQuestionIds(questions: readonly RunQuestion[], answers: RunAnswers): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  questions.forEach((q, i) => {
    if (gradeAt(q, answers[i]).correct || seen.has(q.id)) return;
    seen.add(q.id);
    out.push(q.id);
  });
  return out;
}

/** Weakest subject with at least `minQuestions` items, or null. */
export function weakestSubject(subjects: readonly SubjectResult[], minQuestions = 5): SubjectResult | null {
  const eligible = subjects.filter((s) => s.total >= minQuestions);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => a.pct - b.pct || b.total - a.total)[0];
}

/** Next sitting of an exam key with its format record (FMT-01). */
export function nextSittingFormat(formatExamKey: string, now = new Date()): { date: string; format: SittingFormat | undefined } | null {
  const card = upcomingFormatCards(now, formatExamKey)[0];
  return card ? { date: card.sitting.date, format: card.format } : null;
}

const DURATION_UNITS = { de: { h: "Std.", m: "Min." }, en: { h: "h", m: "min" } } as const;

/** "4 Std.", "1 Std. 30 Min.", "45 Min." (de) or "4 h", "1 h 30 min" (en). */
export function formatDurationLabel(seconds: number, lang: "de" | "en"): string {
  const totalMin = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const { h: hUnit, m: mUnit } = DURATION_UNITS[lang];
  if (h > 0 && m > 0) return `${h} ${hUnit} ${m} ${mUnit}`;
  if (h > 0) return `${h} ${hUnit}`;
  return `${m} ${mUnit}`;
}

/** "1:52" style minutes:seconds. */
export function formatMinSec(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Most ids a practise hand-off carries in the URL; the quiz serves them in order. */
export const PRACTISE_IDS_MAX = 200;

/**
 * Quiz link that practises exactly these question ids (UX-EXM-30). Never uses
 * practiceMode=wrong (Pro-gated): the quiz reads `ids` and serves only those rows.
 */
export function practiseIdsHref(ids: readonly number[], examSource: string): string {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, PRACTISE_IDS_MAX);
  const p = new URLSearchParams({ examSource, ids: clean.join(","), limit: String(clean.length), from: "exam" });
  return `/quiz?${p.toString()}`;
}

/** Weakest topics by accuracy among topics with at least `minAnswered` answers (UX-EXM-24 preset). */
export function weakestTopics(rows: readonly { topic: string; answered: number; accuracy: number }[], n = 3, minAnswered = 10): string[] {
  return rows
    .filter((r) => r.answered >= minAnswered && Number.isFinite(r.accuracy))
    .sort((a, b) => a.accuracy - b.accuracy || b.answered - a.answered)
    .slice(0, n)
    .map((r) => r.topic);
}

/** Whole days from today (Vienna) to an ISO exam date; null when absent or invalid. */
export function daysUntil(examDate: string | null | undefined, now = new Date()): number | null {
  if (!examDate || !/^\d{4}-\d{2}-\d{2}/.test(examDate)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const diff = Math.round((Date.parse(`${examDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(diff) ? diff : null;
}

/** Per-question seconds from the navigation log, each question capped at 30 minutes (time away). */
export function cappedDwell(visits: readonly [number, number][], endMs: number, capS = 1800): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < visits.length; i++) {
    const [idx, start] = visits[i];
    const stop = i + 1 < visits.length ? visits[i + 1][1] : endMs;
    out[idx] = Math.min(capS, (out[idx] ?? 0) + Math.max(0, Math.min(capS, (stop - start) / 1000)));
  }
  return out;
}
