/**
 * One weak-topic rule (MUX-68) for the mentor's progress tool, the mentor
 * Heute card and the study plan, built on the shared learning-metrics
 * thresholds so the mentor never contradicts the app:
 *
 *  - weak:   at least MIN_TOPIC_SAMPLE answered and under PRACTICE_MORE_BELOW_PCT
 *            (the "Mehr üben" status), weakest first
 *  - strong: at least MIN_TOPIC_SAMPLE answered and not weak; never also weak
 *  - thin:   fewer than THIN_MIN_TOPICS topics have enough answers to judge;
 *            then nothing is planned from weak topics ("first 20 mixed questions")
 *
 * Pure module.
 */
import { MIN_TOPIC_SAMPLE, PRACTICE_MORE_BELOW_PCT } from "./learning-metrics";

export const WEAK_BELOW_PCT = PRACTICE_MORE_BELOW_PCT;
export const THIN_MIN_TOPICS = 3;
export const THIN_FIRST_QUESTIONS = 20;

export interface TopicSample {
  topic: string;
  /** Distinct questions answered in the topic. */
  answered: number;
  /** Share correct in percent (0-100), null when unknown. */
  pct: number | null;
}

export interface TopicClassification<T extends TopicSample> {
  weak: T[];
  strong: T[];
  thin: boolean;
}

export function isJudged(t: TopicSample): boolean {
  return t.answered >= MIN_TOPIC_SAMPLE && t.pct !== null && Number.isFinite(t.pct);
}

export function isWeakTopic(t: TopicSample): boolean {
  return isJudged(t) && (t.pct as number) < WEAK_BELOW_PCT;
}

export function classifyTopics<T extends TopicSample>(rows: readonly T[], opts: { weak?: number; strong?: number } = {}): TopicClassification<T> {
  const judged = rows.filter(isJudged);
  const byWeak = (a: T, b: T) => (a.pct as number) - (b.pct as number) || b.answered - a.answered || a.topic.localeCompare(b.topic);
  const byStrong = (a: T, b: T) => (b.pct as number) - (a.pct as number) || b.answered - a.answered || a.topic.localeCompare(b.topic);
  return {
    weak: judged.filter(isWeakTopic).sort(byWeak).slice(0, opts.weak ?? 6),
    strong: judged.filter((t) => !isWeakTopic(t)).sort(byStrong).slice(0, opts.strong ?? 3),
    thin: judged.length < THIN_MIN_TOPICS,
  };
}
