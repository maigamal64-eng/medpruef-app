import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase, type FakeCall, type FakeResult } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
import { GET } from '@/app/api/user/study-plan/route';
import { resetTopicCountsCacheForTests } from '@/lib/free-tier';
const request = () => new NextRequest('https://fixture.invalid/api/user/study-plan');
const baseline = (call: FakeCall): FakeResult => {
  if (call.table === 'users') return { data: { exam_date: null, daily_goal: 40, active_exam: 'pharma' } };
  if (call.table === 'rpc:get_topic_counts') return { data: [{ topic: 'Pharmakologie', count: 100 }] };
  if (call.table === 'user_question_progress') return { count: 7 };
  return { data: [] };
};
beforeEach(() => { vi.clearAllMocks(); resetTopicCountsCacheForTests(); mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' }); });
describe('study plan route without a date', () => {
  it('returns a rolling daily plan with bank-scoped due reviews and never writes', async () => {
    const fake = createFakeSupabase(baseline); mocks.client.mockReturnValue(fake.sb);
    const response = await GET(request()); expect(response.status).toBe(200);
    // a25 (LX-01, pick-plan-target A): no date still means a provisional plan toward the next official sitting, never written.
    const json = await response.json();
    expect(json).toMatchObject({ hasExamDate: false, examDate: null, provisional: true, activeExam: 'pharma', dailyGoal: 40, rollingPlan: { newQuestions: 20, dueReviews: 7 } });
    expect(json.plan.generatedFor).toBe(json.targetDate);
    expect(['next_official_sitting', 'fallback_horizon']).toContain(json.targetSource);
    const due = fake.calls.find(call => call.table === 'user_question_progress');
    expect(due?.filters).toContainEqual({ kind: 'eq', column: 'questions.exam_type', value: 'pharma' });
    expect(due?.filters).toContainEqual({ kind: 'eq', column: 'user_id', value: 'synthetic-owner' });
    expect(due?.filters).toContainEqual({ kind: 'eq', column: 'questions.is_active', value: true });
    expect(fake.calls.every(call => call.op === 'select')).toBe(true);
  });
  it('a saved date regenerates the current bank dated plan in place', async () => {
    const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const fake = createFakeSupabase(call => call.table === 'users' ? { data: { exam_date: date, daily_goal: 20, active_exam: 'pharma' } } : baseline(call));
    mocks.client.mockReturnValue(fake.sb);
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hasExamDate: true, activeExam: 'pharma', examDate: date, plan: { generatedFor: date } });
    expect(fake.calls.find(call => call.table === 'rpc:get_topic_counts')?.payload).toEqual({ p_exam_type: 'pharma' });
    expect(fake.calls.some(call => call.table === 'user_question_progress')).toBe(false);
  });
  for (const table of ['users', 'rpc:get_topic_counts', 'answer_history', 'user_question_progress']) {
    it(`${table} failure cannot masquerade as empty or zero progress`, async () => {
      const fake = createFakeSupabase(call => call.table === table ? { error: { code: '57014' } } : baseline(call)); mocks.client.mockReturnValue(fake.sb);
      const response = await GET(request());
      // a-db-timeouts: a statement timeout on the bank totals is a typed, retryable 503.
      expect(response.status).toBe(table === 'rpc:get_topic_counts' ? 503 : 500);
      expect(await response.json()).not.toHaveProperty('hasExamDate');
    });
  }
  // a-db-timeouts (ERR-05): the plan is never built from missing bank totals.
  it('an unavailable topic-counts read is 503 DB_UNAVAILABLE with Retry-After', async () => {
    const fake = createFakeSupabase(call => call.table === 'rpc:get_topic_counts' ? { error: { code: '', message: 'DbUnavailableError: Database did not answer within 8000 ms' } } : baseline(call));
    mocks.client.mockReturnValue(fake.sb);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('15');
    expect(await response.json()).toMatchObject({ code: 'DB_UNAVAILABLE' });
  });
  it('another topic-counts failure is a typed 500, an empty bank a typed 503, and neither is cached', async () => {
    const failing = createFakeSupabase(call => call.table === 'rpc:get_topic_counts' ? { error: { code: '42883', message: 'function missing' } } : baseline(call));
    mocks.client.mockReturnValue(failing.sb);
    const failed = await GET(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ code: 'TOPIC_COUNTS_FAILED' });
    const empty = createFakeSupabase(call => call.table === 'rpc:get_topic_counts' ? { data: [] } : baseline(call));
    mocks.client.mockReturnValue(empty.sb);
    const blank = await GET(request());
    expect(blank.status).toBe(503);
    expect(await blank.json()).toMatchObject({ code: 'TOPIC_COUNTS_EMPTY' });
    const healthy = createFakeSupabase(baseline);
    mocks.client.mockReturnValue(healthy.sb);
    expect((await GET(request())).status).toBe(200);
    expect(healthy.calls.some(call => call.table === 'rpc:get_topic_counts')).toBe(true);
  });
});
