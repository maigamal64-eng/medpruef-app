import { describe, expect, it } from 'vitest';
import { buildRollingStudyPlan, isStudyPlanResponse, passReceiptFromResponse, readPassReceipt } from '@/lib/study-p0';
import { checkedJson, DataResponseError } from '@/lib/async-data';

const topic = (name: string, total: number, answered = 0) => ({ topic: name, total, answered, correct: 0, accuracy: 0 });
describe('open-ended study plan', () => {
  it('provides a 20-new daily target plus actual due count without inventing a sitting or phases', () => {
    const plan = buildRollingStudyPlan([topic('A', 100), topic('B', 90), topic('C', 70)], 8);
    expect(plan.newQuestions).toBe(20);
    expect(plan.dueReviews).toBe(8);
    expect(plan.topics.reduce((sum, t) => sum + t.targetCount, 0)).toBe(20);
    for (const field of ['examDate', 'generatedFor', 'phaseBreak', 'totalDays', 'endDate']) expect(plan).not.toHaveProperty(field);
  });
  it('does not assign mastered topics or more unseen questions than remain', () => {
    expect(buildRollingStudyPlan([topic('mastered', 100, 100), topic('nearly', 100, 98)], 0).topics).toEqual([{ topic: 'nearly', targetCount: 2 }]);
    expect(buildRollingStudyPlan([], 0).topics).toEqual([]);
  });
});
describe('pass acknowledgement is based on a checked write receipt', () => {
  const body = { ok: true, result: 'pass', attempt_id: 'attempt-1' };
  it('accepts only a real 2xx success with a recorded pass id', () => {
    const receipt = passReceiptFromResponse({ ok: true }, body, 'user', 1000);
    expect(readPassReceipt(JSON.stringify(receipt), 'user', 1001)).toEqual(receipt);
    expect(passReceiptFromResponse({ ok: false }, body, 'user')).toBeNull();
    expect(passReceiptFromResponse({ ok: true }, { ok: true }, 'user')).toBeNull();
    expect(readPassReceipt(null, 'user')).toBeNull();
    expect(readPassReceipt('{"examPassed":1}', 'user')).toBeNull();
  });
  it('never acknowledges another account or an expired receipt', () => {
    const receipt = JSON.stringify(passReceiptFromResponse({ ok: true }, body, 'user', 1000));
    expect(readPassReceipt(receipt, 'another', 1001)).toBeNull();
    expect(readPassReceipt(receipt, 'user', 601001)).toBeNull();
  });
});
describe('read errors retain their HTTP cause instead of resembling empty data', () => {
  it('distinguishes 500 from a successful empty result and rejects malformed 200', async () => {
    const valid = (value: unknown): value is { hasExamDate: false } => !!value && typeof value === 'object' && 'hasExamDate' in value && value.hasExamDate === false;
    await expect(checkedJson(new Response('{"error":"failure"}', { status: 500 }), valid)).rejects.toMatchObject({ status: 500 });
    await expect(checkedJson(new Response('{"plan":null}'), valid)).rejects.toBeInstanceOf(DataResponseError);
    await expect(checkedJson(new Response('{"hasExamDate":false}'), valid)).resolves.toEqual({ hasExamDate: false });
  });
});

describe('study-plan response contract', () => {
  it('rejects false dates, malformed rolling counters and broken day blocks before rendering', () => {
    expect(isStudyPlanResponse({ plan: null, hasExamDate: false })).toBe(true);
    expect(isStudyPlanResponse({ plan: null, hasExamDate: true })).toBe(false);
    expect(isStudyPlanResponse({ plan: null, hasExamDate: false, rollingPlan: { newQuestions: 20, dueReviews: '4', topics: [] } })).toBe(false);
    expect(isStudyPlanResponse({ plan: null, hasExamDate: false, rollingPlan: buildRollingStudyPlan([], 4) })).toBe(true);
  });
});
