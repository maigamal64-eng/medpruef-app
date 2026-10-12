import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase, type FakeCall, type FakeResult } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
import { GET } from '@/app/api/user/study-plan/route';
const request = () => new NextRequest('https://fixture.invalid/api/user/study-plan');
const baseline = (call: FakeCall): FakeResult => {
  if (call.table === 'users') return { data: { exam_date: null, daily_goal: 40, active_exam: 'pharma' } };
  if (call.table === 'rpc:get_topic_counts') return { data: [{ topic: 'Pharmakologie', count: 100 }] };
  if (call.table === 'user_question_progress') return { count: 7 };
  return { data: [] };
};
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' }); });
describe('study plan route without a date', () => {
  it('returns a rolling daily plan with bank-scoped due reviews and never writes', async () => {
    const fake = createFakeSupabase(baseline); mocks.client.mockReturnValue(fake.sb);
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: null, hasExamDate: false, activeExam: 'pharma', dailyGoal: 20, rollingPlan: { newQuestions: 20, dueReviews: 7 } });
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
      const response = await GET(request()); expect(response.status).toBe(500);
      expect(await response.json()).not.toHaveProperty('hasExamDate');
    });
  }
});
