/**
 * Learning metrics (UX-GLOBAL-06): three named measures computed once on the
 * server and read, never recomputed, by Home, Fortschritt, Statistik and
 * Lernplan.
 *
 *  - gesehen (coverage): distinct questions seen over the bank or topic total,
 *    always shown with its denominator.
 *  - zuletzt richtig: share of distinct answered questions whose newest attempt
 *    was correct, always shown with its sample.
 *  - Trefferquote: correct answers over all answers of a period or run.
 *
 * Open mistakes follow PRA-55: a question is open while its newest attempt is
 * wrong, or until it has two correct answers since the last miss with the
 * second at least one day after the first. Topic status thresholds are shared
 * here: "Zu wenig Antworten" below 10 distinct answered questions, "Mehr üben"
 * below 60 % zuletzt richtig, no label in between ("Stark" waits for [name]'s
 * pass rule). Pure module.
 */

export const MIN_TOPIC_SAMPLE = 10;
export const PRACTICE_MORE_BELOW_PCT = 60;
export const TREND_MIN_SAMPLE = 20;
const DAY_MS = 86_400_000;

export interface Attempt {
  questionId: number;
  isCorrect: boolean;
  /** ISO timestamp of the answer. */
  at: string;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Newest attempt per question (ties broken by array order: later wins). */
export function latestAttempts(attempts: readonly Attempt[]): Map<number, Attempt> {
  const latest = new Map<number, Attempt>();
  for (const a of attempts) {
    const prev = latest.get(a.questionId);
    if (!prev || Date.parse(a.at) >= Date.parse(prev.at)) latest.set(a.questionId, a);
  }
  return latest;
}

export interface Coverage { seen: number; total: number; pct: number | null }
export function coverage(attempts: readonly Attempt[], total: number): Coverage {
  const seen = new Set(attempts.map(a => a.questionId)).size;
  return { seen, total, pct: pct(Math.min(seen, total), total) };
}

export interface LastCorrect { correct: number; sample: number; pct: number | null }
export function lastCorrect(attempts: readonly Attempt[]): LastCorrect {
  const latest = [...latestAttempts(attempts).values()];
  const correct = latest.filter(a => a.isCorrect).length;
  return { correct, sample: latest.length, pct: pct(correct, latest.length) };
}

export interface HitRate { correct: number; answers: number; pct: number | null }
export function hitRate(attempts: readonly Attempt[]): HitRate {
  const correct = attempts.filter(a => a.isCorrect).length;
  return { correct, answers: attempts.length, pct: pct(correct, attempts.length) };
}

/** PRA-55 graduation rule for one question's attempts. */
export function isOpenMistake(attempts: readonly Attempt[]): boolean {
  const ordered = [...attempts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let lastMiss = -1;
  ordered.forEach((a, i) => { if (!a.isCorrect) lastMiss = i; });
  if (lastMiss === -1) return false;
  const since = ordered.slice(lastMiss + 1).filter(a => a.isCorrect);
  if (since.length < 2) return true;
  const first = Date.parse(since[0].at);
  return !since.slice(1).some(a => Date.parse(a.at) - first >= DAY_MS);
}

export function openMistakeIds(attempts: readonly Attempt[]): number[] {
  const byQuestion = new Map<number, Attempt[]>();
  for (const a of attempts) byQuestion.set(a.questionId, [...(byQuestion.get(a.questionId) ?? []), a]);
  return [...byQuestion.entries()].filter(([, list]) => isOpenMistake(list)).map(([id]) => id).sort((a, b) => a - b);
}

export type TopicStatus = 'too_few' | 'practice_more' | null;
export function topicStatus(answeredDistinct: number, lastCorrectPct: number | null | undefined): TopicStatus {
  if (answeredDistinct < MIN_TOPIC_SAMPLE) return 'too_few';
  if (lastCorrectPct != null && lastCorrectPct < PRACTICE_MORE_BELOW_PCT) return 'practice_more';
  return null;
}

/** Trend arrows only with enough distinct answers, and always with text. */
export function showTrend(answeredDistinct: number): boolean {
  return answeredDistinct >= TREND_MIN_SAMPLE;
}

type Lang = string;
const de = (lang: Lang) => lang === 'de';
function num(n: number, lang: Lang): string {
  return n.toLocaleString(de(lang) ? 'de-AT' : 'en-GB');
}

export const METRIC_LABELS = {
  seen: { de: 'gesehen', en: 'seen' },
  lastCorrect: { de: 'Zuletzt richtig', en: 'Last correct' },
  hitRate: { de: 'Trefferquote', en: 'Hit rate' },
  readinessHitRate: { de: 'Trefferquote, letzte 50 Antworten', en: 'Hit rate, last 50 answers' },
  readiness: { de: 'Übungsstand', en: 'Practice level' },
  readinessNote: { de: 'Orientierung, keine Vorhersage', en: 'Guidance, not a prediction' },
} as const;

export function coverageText(c: Coverage, lang: Lang): string {
  return de(lang) ? `${num(c.seen, lang)} von ${num(c.total, lang)} gesehen` : `${num(c.seen, lang)} of ${num(c.total, lang)} seen`;
}

export function lastCorrectText(l: LastCorrect, lang: Lang): string | null {
  if (l.pct == null) return null;
  return de(lang) ? `${l.pct} % zuletzt richtig, ${num(l.sample, lang)} Fragen` : `${l.pct}% last correct, ${num(l.sample, lang)} questions`;
}

export function topicStatusText(status: TopicStatus, lang: Lang): { label: string; definition: string } | null {
  if (status === 'too_few') return de(lang)
    ? { label: 'Zu wenig Antworten', definition: `Ab ${MIN_TOPIC_SAMPLE} beantworteten Fragen gibt es eine Einschätzung.` }
    : { label: 'Too few answers', definition: `A rating appears from ${MIN_TOPIC_SAMPLE} answered questions.` };
  if (status === 'practice_more') return de(lang)
    ? { label: 'Mehr üben', definition: `Unter ${PRACTICE_MORE_BELOW_PCT} % richtig beantwortet (ab ${MIN_TOPIC_SAMPLE} Fragen)` }
    : { label: 'Practise more', definition: `Under ${PRACTICE_MORE_BELOW_PCT}% answered correctly (from ${MIN_TOPIC_SAMPLE} questions)` };
  return null;
}

/** Server row shape the topic-progress route returns per topic. */
export interface TopicMetrics {
  topic: string;
  total: number;
  /** Distinct questions seen (coverage numerator). */
  answered: number;
  coveragePct: number | null;
  /** Distinct answered with a known newest attempt; null before the RPC exists. */
  lastCorrectSample: number | null;
  lastCorrectPct: number | null;
  status: TopicStatus;
}

export function topicMetrics(row: { topic: string; total: number; answered: number; lastCorrect?: number | null; lastSample?: number | null }): TopicMetrics {
  const total = Math.max(0, row.total);
  const answered = Math.max(0, row.answered);
  const sample = row.lastSample == null ? null : Math.max(0, row.lastSample);
  const lastPct = sample == null || row.lastCorrect == null ? null : pct(row.lastCorrect, sample);
  return {
    topic: row.topic,
    total,
    answered,
    coveragePct: pct(Math.min(answered, total), total),
    lastCorrectSample: sample,
    lastCorrectPct: lastPct,
    // Without the newest-attempt read only the sample rule can be applied.
    status: topicStatus(sample ?? answered, lastPct),
  };
}
