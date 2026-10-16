import { isRecord } from './async-data';
import type { TopicProgress, StudyPlan } from './studyPlan';

export interface RollingStudyPlan {
  newQuestions: 20;
  dueReviews: number;
  topics: { topic: string; targetCount: number }[];
}
/** No invented sitting, end date or phase. Rebuilt from current progress each read. */
export function buildRollingStudyPlan(topics: TopicProgress[], dueReviews: number): RollingStudyPlan {
  const pool = topics.filter(t => t.total > t.answered).sort((a, b) => (b.total - b.answered) - (a.total - a.answered));
  const selected = pool.slice(0, 3);
  let remaining = 20;
  const blocks = selected.map((topic, i) => {
    const targetCount = Math.min(topic.total - topic.answered, Math.ceil(remaining / (selected.length - i)));
    remaining -= targetCount;
    return { topic: topic.topic, targetCount };
  });
  return { newQuestions: 20, dueReviews, topics: blocks };
}

export const PASS_RECEIPT_KEY = 'medpruef_pass_receipt';
export interface PassReceipt { userId: string; attemptId: string; recordedAt: number }
/** The caller must provide the actual POST response, never URL flags. */
export function passReceiptFromResponse(response: { ok: boolean }, body: unknown, userId: string, now = Date.now()): PassReceipt | null {
  return response.ok && isRecord(body) && body.ok === true && body.result === 'pass' && typeof body.attempt_id === 'string' && body.attempt_id.length > 0
    ? { userId, attemptId: body.attempt_id, recordedAt: now } : null;
}
export function readPassReceipt(raw: string | null, userId: string, now = Date.now()): PassReceipt | null {
  try {
    const value: unknown = JSON.parse(raw || 'null');
    return isRecord(value) && value.userId === userId && typeof value.attemptId === 'string' && value.attemptId.length > 0 && typeof value.recordedAt === 'number' && now >= value.recordedAt && now - value.recordedAt < 10 * 60_000 ? value as unknown as PassReceipt : null;
  } catch { return null; }
}

export interface StudyPlanResponse {
  plan: StudyPlan | null;
  rollingPlan?: RollingStudyPlan;
  hasExamDate: boolean;
  /** The learner's own date (may be past), or null. */
  examDate?: string | null;
  dailyGoal?: number;
  activeExam?: string;
  /** a25 (LX-01/03): the date the plan targets; provisional until the learner chooses. */
  targetDate?: string;
  provisional?: boolean;
  targetSource?: 'user_exam_date' | 'next_official_sitting' | 'fallback_horizon';
  /** The learner's own date lies in the past. */
  expired?: boolean;
  nextSittings?: string[];
  unseenTotal?: number;
  bankTotal?: number;
  /** Answers on the current Vienna day from the server counters, null when unknown. */
  answeredToday?: number | null;
  focus?: 'all' | 'weak';
  weakAvailable?: boolean;
  /** The learner's Vienna day the plan was built for (a25). */
  todayISO?: string;
  /** a-cram-part-plan: present only while CRAM_PART_PLAN_ENABLED is on. Read through parseCramView. */
  cram?: unknown;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const nonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function isPlan(plan: unknown): plan is StudyPlan {
  return isRecord(plan) && nonnegative(plan.totalDays) && nonnegative(plan.totalQuestions) && typeof plan.phaseBreak === 'string' && typeof plan.generatedFor === 'string' && ['normal', 'tight', 'expired', 'far_future'].includes(String(plan.status)) && Array.isArray(plan.weakTopics) && plan.weakTopics.every(topic => typeof topic === 'string') && Array.isArray(plan.dailySchedule) && plan.dailySchedule.every(day => isRecord(day) && typeof day.day === 'string' && nonnegative(day.totalQuestions) && ['new', 'consolidation'].includes(String(day.phase)) && Array.isArray(day.topics) && day.topics.every(topic => isRecord(topic) && typeof topic.topic === 'string' && nonnegative(topic.targetCount) && ['review', 'weak', 'new'].includes(String(topic.focus))) && (day.simulation === undefined || (isRecord(day.simulation) && typeof day.simulation.presetId === 'string')));
}

function isRolling(rolling: unknown): rolling is RollingStudyPlan {
  return isRecord(rolling) && rolling.newQuestions === 20 && nonnegative(rolling.dueReviews) && Array.isArray(rolling.topics) && rolling.topics.every(topic => isRecord(topic) && typeof topic.topic === 'string' && nonnegative(topic.targetCount));
}

export function isStudyPlanResponse(value: unknown): value is StudyPlanResponse {
  if (!isRecord(value) || typeof value.hasExamDate !== 'boolean') return false;
  if (value.rollingPlan !== undefined && !isRolling(value.rollingPlan)) return false;
  if (value.targetDate !== undefined && !(typeof value.targetDate === 'string' && ISO.test(value.targetDate))) return false;
  if (value.todayISO !== undefined && !(typeof value.todayISO === 'string' && ISO.test(value.todayISO))) return false;
  if (value.nextSittings !== undefined && !(Array.isArray(value.nextSittings) && value.nextSittings.every(d => typeof d === 'string' && ISO.test(d)))) return false;
  if (value.answeredToday !== undefined && value.answeredToday !== null && !nonnegative(value.answeredToday)) return false;
  if (!value.hasExamDate) {
    // Older servers: confirmed absence with no plan. a25: a provisional plan toward a target date.
    if (value.plan === null) return true;
    return isPlan(value.plan) && typeof value.targetDate === 'string';
  }
  return typeof value.examDate === 'string' && ISO.test(value.examDate) && isPlan(value.plan);
}
