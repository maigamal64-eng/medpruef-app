/**
 * Per-subject trend across full mock exams (INF-04, acceptance text of
 * UX-EXM-42). Pure: the route loads the learner's own exam_simulations rows
 * and the topics of their question ids; this groups them.
 *
 * Rules:
 *   - Only full-length runs count (part "all" or a full preset); custom,
 *     part runs and KAF self-marked runs never enter the trend.
 *   - Comparable runs share a preset (legacy rows without presetId fall back
 *     to their bank's full run).
 *   - The per-subject series appears only from three comparable runs.
 *   - A delta against the previous run, and the gap to 60 percent, need at
 *     least MIN_SUBJECT_QUESTIONS questions of that subject in the run(s).
 * The page adds "Das ist keine Vorhersage Ihres Ergebnisses." No pass words.
 */

export const MIN_COMPARABLE_RUNS = 3;
export const MIN_SUBJECT_QUESTIONS = 10;
export const MARK_PCT = 60;
const MAX_POINTS = 6;

const FULL_PRESETS = new Set(["kp_full", "kmp_innsbruck_legacy", "spt_250"]);
const LEGACY_FULL: Record<string, string> = {
  kenntnispruefung: "kp_full",
  kmp_innsbruck: "kmp_innsbruck_legacy",
};

export interface TrendAttemptInput {
  id: string;
  completedAt: string;
  examType: string;
  config: Record<string, unknown> | null;
  questionIds: readonly number[];
  grading: Record<string, { is_correct?: unknown } | undefined> | null;
}

export interface SubjectPoint {
  at: string;
  correct: number;
  total: number;
  /** Rounded percent, null when the subject had no question in that run. */
  pct: number | null;
}

export interface SubjectTrend {
  topic: string;
  points: SubjectPoint[];
  /** Latest point minus 60, only with enough questions in the latest run. */
  gapToMark: number | null;
  /** Latest minus previous, only with enough questions in both. */
  delta: number | null;
}

export interface ExamTrend {
  /** Full-length runs completed, all presets. */
  fullRuns: number;
  /** Comparable group of the newest full run, or null without any. */
  presetId: string | null;
  comparableRuns: number;
  /** Empty until MIN_COMPARABLE_RUNS comparable runs exist. */
  subjects: SubjectTrend[];
}

function str(config: Record<string, unknown> | null, key: string): string | null {
  const v = config?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The comparable full-run key of an attempt, or null when it is not a full run. */
export function fullRunKey(a: Pick<TrendAttemptInput, "config" | "examType">): string | null {
  const config = a.config && typeof a.config === "object" ? a.config : null;
  if (str(config, "kind") === "kaf") return null;
  const preset = str(config, "presetId");
  if (preset) return FULL_PRESETS.has(preset) ? preset : null;
  const part = str(config, "part");
  // Rows saved before presetId existed: a full run of the bank.
  if (part === "all" || (!part && !config)) return LEGACY_FULL[a.examType] ?? null;
  return null;
}

function isCorrect(grading: TrendAttemptInput["grading"], qid: number): boolean {
  return grading?.[String(qid)]?.is_correct === true;
}

export function buildExamTrend(
  attempts: readonly TrendAttemptInput[],
  topicById: ReadonlyMap<number, string>,
): ExamTrend {
  const full = attempts
    .map((a) => ({ a, key: fullRunKey(a) }))
    .filter((x): x is { a: TrendAttemptInput; key: string } => x.key !== null && !Number.isNaN(Date.parse(x.a.completedAt)))
    .sort((x, y) => Date.parse(x.a.completedAt) - Date.parse(y.a.completedAt));
  const fullRuns = full.length;
  if (fullRuns === 0) return { fullRuns: 0, presetId: null, comparableRuns: 0, subjects: [] };

  const presetId = full[full.length - 1].key;
  const group = full.filter((x) => x.key === presetId).map((x) => x.a).slice(-MAX_POINTS);
  const comparableRuns = full.filter((x) => x.key === presetId).length;
  if (comparableRuns < MIN_COMPARABLE_RUNS) return { fullRuns, presetId, comparableRuns, subjects: [] };

  const perRun = group.map((a) => {
    const counts = new Map<string, { correct: number; total: number }>();
    for (const qid of a.questionIds) {
      const topic = topicById.get(qid);
      if (!topic) continue; // removed questions are left out, never counted as wrong
      const c = counts.get(topic) ?? { correct: 0, total: 0 };
      c.total += 1;
      if (isCorrect(a.grading, qid)) c.correct += 1;
      counts.set(topic, c);
    }
    return { at: a.completedAt, counts };
  });

  const topics = Array.from(new Set(perRun.flatMap((r) => Array.from(r.counts.keys())))).sort((x, y) => x.localeCompare(y));
  const subjects: SubjectTrend[] = topics.map((topic) => {
    const points: SubjectPoint[] = perRun.map((r) => {
      const c = r.counts.get(topic) ?? { correct: 0, total: 0 };
      return { at: r.at, correct: c.correct, total: c.total, pct: c.total > 0 ? Math.round((c.correct / c.total) * 100) : null };
    });
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const lastOk = !!last && last.total >= MIN_SUBJECT_QUESTIONS && last.pct !== null;
    const prevOk = !!prev && prev.total >= MIN_SUBJECT_QUESTIONS && prev.pct !== null;
    return {
      topic,
      points,
      gapToMark: lastOk ? (last.pct as number) - MARK_PCT : null,
      delta: lastOk && prevOk ? (last.pct as number) - (prev.pct as number) : null,
    };
  });
  // Lowest latest score first, so the subject that needs work leads.
  subjects.sort((x, y) => (x.points.at(-1)?.pct ?? 101) - (y.points.at(-1)?.pct ?? 101) || x.topic.localeCompare(y.topic));
  return { fullRuns, presetId, comparableRuns, subjects };
}
