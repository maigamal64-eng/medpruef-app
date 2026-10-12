/**
 * Next-step resolver (UX-GLOBAL-33): one answer to "what should I do now",
 * shared by the Home hero, the practice hub, Lernplan "Heute dran", the
 * Fortschritt target and the result card. Pure; callers pass server state,
 * the local trail and `now`.
 *
 * Phase A order: today's plan task, else an unfinished session under 7 days
 * old (named honestly as the last topic, not a resume), else the weakest
 * topic above the sample minimum, else new questions. Phase B (due reviews as
 * their own capped session) only when the caller enables it and has a due
 * count; free accounts never get a gated target as the default.
 */
import { canUse, type Audience } from './entitlements';
import { buildQuizHref } from './quiz-links';
import { MIN_TOPIC_SAMPLE, topicStatus } from './learning-metrics';

export const SESSION_CAP = 20;
export const RESUME_MAX_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

type Text = { de: string; en: string };

export interface NextStepInput {
  audience: Audience;
  exam: string;
  now: Date;
  /** Daily goal in questions; 0 or unknown falls back to one 10-question round. */
  dailyGoal?: number | null;
  answeredToday?: number | null;
  planTask?: { topic: string | null; count: number } | null;
  lastSession?: { topic: string; lastActiveAt: string } | null;
  /** Candidate weak topics from the server metrics (any order). */
  topics?: { topic: string; answeredDistinct: number; lastCorrectPct: number | null }[] | null;
  /** Phase B only: server due count (null = unknown, never invented). */
  dueCapped?: number | null;
  phaseB?: boolean;
  /** Learner's real median seconds per answer; minutes are omitted without it. */
  medianAnswerSeconds?: number | null;
}

export type NextStepKind = 'goal_done' | 'plan_task' | 'last_topic' | 'due_review' | 'weak_topic' | 'new_questions';

export interface NextStep {
  kind: NextStepKind;
  href: string;
  size: number;
  minutes: number | null;
  label: Text;
  why: Text;
  /** Done state only: an optional outline action for ten more questions. */
  more?: { href: string; label: Text };
}

/** Free learners practise the topic (in their sample); Pro reviews its mistakes. */
export function weakTopicHref(topic: string, exam: string, audience: Audience, limit = 10): string {
  return canUse('mistake_review', audience)
    ? buildQuizHref({ topic, examSource: exam, practiceMode: 'wrong', limit })
    : buildQuizHref({ topic, examSource: exam, limit });
}

function sessionSize(input: NextStepInput): number {
  const goal = input.dailyGoal && input.dailyGoal > 0 ? input.dailyGoal : 0;
  if (!goal) return 10;
  const remaining = goal - Math.max(0, input.answeredToday ?? 0);
  return Math.max(1, Math.min(remaining, SESSION_CAP));
}

function minutesFor(size: number, median: number | null | undefined): number | null {
  if (!median || !Number.isFinite(median) || median <= 0) return null;
  return Math.max(1, Math.round((size * median) / 60));
}

export function resolveNextStep(input: NextStepInput): NextStep {
  const goal = input.dailyGoal && input.dailyGoal > 0 ? input.dailyGoal : 0;
  const exam = input.exam;
  if (goal && (input.answeredToday ?? 0) >= goal) {
    return {
      kind: 'goal_done',
      href: '/',
      size: 0,
      minutes: null,
      label: { de: 'Tagesziel erreicht', en: 'Daily goal reached' },
      why: { de: 'Morgen geht es mit neuen Fragen weiter.', en: 'Tomorrow continues with new questions.' },
      more: { href: buildQuizHref({ examSource: exam, limit: 10 }), label: { de: 'Noch 10 Fragen', en: '10 more questions' } },
    };
  }
  const size = sessionSize(input);
  const minutes = minutesFor(size, input.medianAnswerSeconds);
  const step = (kind: NextStepKind, href: string, label: Text, why: Text, n = size): NextStep => ({ kind, href, size: n, minutes: minutesFor(n, input.medianAnswerSeconds) ?? (n === size ? minutes : null), label, why });

  if (input.planTask && input.planTask.count > 0) {
    const n = Math.min(input.planTask.count, SESSION_CAP);
    const topic = input.planTask.topic;
    return step('plan_task', buildQuizHref({ examSource: exam, topic: topic ?? undefined, limit: n }),
      topic ? { de: `${n} Fragen: ${topic}`, en: `${n} questions: ${topic}` } : { de: `${n} Fragen aus Ihrem Lernplan`, en: `${n} questions from your plan` },
      { de: 'Heute in Ihrem Lernplan.', en: 'Planned for today.' }, n);
  }

  const last = input.lastSession;
  if (last?.topic) {
    const age = input.now.getTime() - Date.parse(last.lastActiveAt);
    if (Number.isFinite(age) && age >= 0 && age < RESUME_MAX_AGE_DAYS * DAY_MS) {
      return step('last_topic', buildQuizHref({ examSource: exam, topic: last.topic, limit: size }),
        { de: `${size} Fragen: ${last.topic}`, en: `${size} questions: ${last.topic}` },
        { de: `Letztes Thema: ${last.topic}`, en: `Last topic: ${last.topic}` });
    }
  }

  if (input.phaseB && canUse('spaced_repetition', input.audience) && input.dueCapped && input.dueCapped > 0) {
    const n = Math.min(input.dueCapped, SESSION_CAP);
    return step('due_review', buildQuizHref({ examSource: exam, practiceMode: 'review', limit: n }),
      { de: `${n} Wiederholungen`, en: `${n} reviews` },
      { de: 'Heute fällig.', en: 'Due today.' }, n);
  }

  const weak = (input.topics ?? [])
    .filter(t => t.answeredDistinct >= MIN_TOPIC_SAMPLE && topicStatus(t.answeredDistinct, t.lastCorrectPct) === 'practice_more')
    .sort((a, b) => (a.lastCorrectPct ?? 0) - (b.lastCorrectPct ?? 0) || b.answeredDistinct - a.answeredDistinct || a.topic.localeCompare(b.topic))[0];
  if (weak) {
    return step('weak_topic', weakTopicHref(weak.topic, exam, input.audience, size),
      { de: `${size} Fragen: ${weak.topic}`, en: `${size} questions: ${weak.topic}` },
      { de: `Schwächstes Fachgebiet: ${weak.lastCorrectPct} % zuletzt richtig`, en: `Weakest topic: ${weak.lastCorrectPct}% last correct` });
  }

  return step('new_questions', buildQuizHref({ examSource: exam, practiceMode: 'unseen', limit: size }),
    { de: `${size} neue Fragen üben`, en: `Practise ${size} new questions` },
    { de: 'Noch nicht gesehene Fragen aus Ihrer Fragenbank.', en: 'Questions you have not seen yet.' });
}
