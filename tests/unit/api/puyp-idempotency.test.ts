import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), completion: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
vi.mock('@/lib/sentry-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/puyp', () => ({ computeQbankCompletion: mocks.completion }));
import { POST } from '@/app/api/puyp/result/route';
const request = () => new NextRequest('https://fixture.invalid/api/puyp/result', { method: 'POST', body: JSON.stringify({ result: 'pass', exam_type: 'kenntnispruefung', attempt_date: '2026-10-11' }) });
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' }); mocks.completion.mockResolvedValue({ pct: 75 }); });
describe('pass idempotency and database arbitration', () => {
  it('returns existing pass without a new insert or telemetry write', async () => {
    const fake = createFakeSupabase(call => call.table === 'users' ? { data: { active_exam: 'kenntnispruefung', exam_date: '2026-10-11' } } : call.table === 'exam_attempts' ? { data: { id: 'original' } } : {});
    mocks.client.mockReturnValue(fake.sb);
    expect(await (await POST(request())).json()).toMatchObject({ ok: true, duplicate: true, attempt_id: 'original' });
    expect(fake.calls.filter(call => call.op === 'insert')).toHaveLength(0);
    expect(fake.calls.find(call => call.table === 'exam_attempts')?.filters).toContainEqual({ kind: 'eq', column: 'user_id', value: 'synthetic-owner' });
  });
  it('a concurrent unique-index conflict returns the winning record', async () => {
    let reads = 0;
    const fake = createFakeSupabase(call => {
      if (call.table === 'users') return { data: { active_exam: 'kenntnispruefung', exam_date: '2026-10-11' } };
      if (call.table === 'exam_attempts' && call.op === 'insert') return { error: { code: '23505' } };
      if (call.table === 'exam_attempts') return { data: ++reads === 1 ? null : { id: 'winner' } };
      return {};
    }); mocks.client.mockReturnValue(fake.sb);
    expect(await (await POST(request())).json()).toMatchObject({ duplicate: true, attempt_id: 'winner' });
    expect(fake.calls.filter(call => call.table === 'user_events')).toHaveLength(0);
  });
  it('prior-lookup failure fails closed without inserting', async () => {
    const fake = createFakeSupabase(call => call.table === 'users' ? { data: { active_exam: 'pharma', exam_date: '2026-10-11' } } : { error: { code: '57014' } });
    mocks.client.mockReturnValue(fake.sb);
    expect((await POST(request())).status).toBe(500);
    expect(fake.calls.filter(call => call.op === 'insert')).toHaveLength(0);
  });
});
