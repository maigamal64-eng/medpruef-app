/**
 * learner-stats: study figures for the admin learner page, computed on the
 * server from every answer row (ADM-07 A). Vienna calendar days.
 *
 * Before a16 the dossier asked PostgREST for 4000 answers and silently got
 * 1000 (max_rows), so the 7 learners above 1000 answers had understated
 * accuracy, topics and heatmaps. The route now pages through all rows and
 * this file only does the arithmetic. Streaks come from answer days, not the
 * user_gamification counter, which freezes when a learner stops studying.
 */

import { lastViennaDays, viennaDay } from "@/lib/admin/money-rules";

export interface AnswerLike {
  question_id: number | null;
  is_correct: boolean | null;
  time_spent_ms: number | null;
  xp_earned: number | null;
  created_at: string;
}

export interface QuestionMetaLike {
  topic: string | null;
  exam_type: string | null;
}

export interface LearnerStudyStats {
  answersLogged: number;
  answersCorrect: number;
  accuracy: number;
  totalTimeMs: number;
  avgTimeMs: number;
  xpFromAnswers: number;
  activeDays: number;
  firstActivity: string | null;
  lastAnswerAt: string | null;
  currentStreak: number;
  longestStreak: number;
  heatmap: Array<{ date: string; count: number }>;
  trend: Array<{ date: string; answered: number; correct: number }>;
  topics: Array<{ topic: string; answered: number; correct: number; accuracy: number }>;
  exams: Array<{ examType: string; answered: number; correct: number }>;
}

const REMOVED_TOPIC = "Unbekannt / entfernt";

function prevDay(day: string): string {
  // Noon UTC never crosses a Vienna day boundary when stepping back 24h.
  const t = Date.parse(`${day}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Current and longest run of consecutive Vienna days with an answer. */
export function streaksFromDays(days: Set<string>, now: Date): { current: number; longest: number } {
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const d of sorted) {
    run = previous !== null && prevDay(d) === previous ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = d;
  }
  const today = viennaDay(now);
  let cursor = days.has(today) ? today : prevDay(today);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = prevDay(cursor);
  }
  return { current, longest };
}

export function computeLearnerStudyStats(
  answers: AnswerLike[],
  meta: Map<number, QuestionMetaLike>,
  now: Date,
  opts: { heatmapDays?: number; trendDays?: number } = {},
): LearnerStudyStats {
  const heatmapDays = opts.heatmapDays ?? 182;
  const trendDays = opts.trendDays ?? 30;
  const perDay = new Map<string, { answered: number; correct: number }>();
  const topics = new Map<string, { answered: number; correct: number }>();
  const exams = new Map<string, { answered: number; correct: number }>();
  let correct = 0;
  let totalTimeMs = 0;
  let xp = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  for (const a of answers) {
    const t = Date.parse(a.created_at);
    if (!Number.isFinite(t)) continue;
    if (t < first) first = t;
    if (t > last) last = t;
    const ok = a.is_correct === true;
    if (ok) correct += 1;
    totalTimeMs += a.time_spent_ms ?? 0;
    xp += a.xp_earned ?? 0;
    const day = viennaDay(t);
    const d = perDay.get(day) ?? { answered: 0, correct: 0 };
    d.answered += 1;
    if (ok) d.correct += 1;
    perDay.set(day, d);
    const m = a.question_id != null ? meta.get(a.question_id) : undefined;
    const topicKey = m?.topic || REMOVED_TOPIC;
    const tp = topics.get(topicKey) ?? { answered: 0, correct: 0 };
    tp.answered += 1;
    if (ok) tp.correct += 1;
    topics.set(topicKey, tp);
    const examKey = m?.exam_type || "unknown";
    const ex = exams.get(examKey) ?? { answered: 0, correct: 0 };
    ex.answered += 1;
    if (ok) ex.correct += 1;
    exams.set(examKey, ex);
  }

  const counted = [...perDay.values()].reduce((s, d) => s + d.answered, 0);
  const streak = streaksFromDays(new Set(perDay.keys()), now);
  return {
    answersLogged: counted,
    answersCorrect: correct,
    accuracy: counted ? Math.round((correct / counted) * 100) : 0,
    totalTimeMs,
    avgTimeMs: counted ? Math.round(totalTimeMs / counted) : 0,
    xpFromAnswers: xp,
    activeDays: perDay.size,
    firstActivity: Number.isFinite(first) ? new Date(first).toISOString() : null,
    lastAnswerAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    heatmap: lastViennaDays(now, heatmapDays).map((date) => ({ date, count: perDay.get(date)?.answered ?? 0 })),
    trend: lastViennaDays(now, trendDays).map((date) => ({
      date,
      answered: perDay.get(date)?.answered ?? 0,
      correct: perDay.get(date)?.correct ?? 0,
    })),
    topics: [...topics.entries()]
      .map(([topic, v]) => ({ topic, answered: v.answered, correct: v.correct, accuracy: v.answered ? Math.round((v.correct / v.answered) * 100) : 0 }))
      .sort((a, b) => b.answered - a.answered),
    exams: [...exams.entries()]
      .map(([examType, v]) => ({ examType, answered: v.answered, correct: v.correct }))
      .sort((a, b) => b.answered - a.answered),
  };
}
