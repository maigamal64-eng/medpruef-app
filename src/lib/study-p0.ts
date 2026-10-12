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
  examDate?: string | null;
  dailyGoal?: number;
  activeExam?: string;
}
export function isStudyPlanResponse(value: unknown): value is StudyPlanResponse {
  if (!isRecord(value) || typeof value.hasExamDate !== 'boolean') return false;
  const nonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!value.hasExamDate) {
    if (value.plan !== null) return false;
    if (value.rollingPlan === undefined) return true; // confirmed absence from older server fixtures
    const rolling = value.rollingPlan;
    return isRecord(rolling) && rolling.newQuestions === 20 && nonnegative(rolling.dueReviews) && Array.isArray(rolling.topics) && rolling.topics.every(topic => isRecord(topic) && typeof topic.topic === 'string' && nonnegative(topic.targetCount));
  }
  const plan = value.plan;
  return typeof value.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.examDate) && isRecord(plan) && nonnegative(plan.totalDays) && nonnegative(plan.totalQuestions) && typeof plan.phaseBreak === 'string' && typeof plan.generatedFor === 'string' && ['normal', 'tight', 'expired', 'far_future'].includes(String(plan.status)) && Array.isArray(plan.weakTopics) && plan.weakTopics.every(topic => typeof topic === 'string') && Array.isArray(plan.dailySchedule) && plan.dailySchedule.every(day => isRecord(day) && typeof day.day === 'string' && nonnegative(day.totalQuestions) && ['new', 'consolidation'].includes(String(day.phase)) && Array.isArray(day.topics) && day.topics.every(topic => isRecord(topic) && typeof topic.topic === 'string' && nonnegative(topic.targetCount) && ['review', 'weak', 'new'].includes(String(topic.focus))));
}
