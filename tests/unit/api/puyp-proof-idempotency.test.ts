import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), completion: vi.fn(), eligible: vi.fn(), gate: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
vi.mock('@/lib/sentry-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/nowpayments', () => ({ isPuypEligibleTier: mocks.eligible }));
vi.mock('@/lib/puyp', () => ({ computeQbankCompletion: mocks.completion, meetsPuypCompletionGate: mocks.gate, PUYP_COMPLETION_THRESHOLD_PCT: 70, PUYP_MAX_EXTENSIONS: 2 }));
import { POST } from '@/app/api/puyp/submit/route';
const action = '00000000-0000-4000-8000-000000000051';
const request = (key: string | null = action) => {
  const form = new FormData(); if (key) form.set('idempotency_key', key);
  form.set('proof', new File(['synthetic'], 'proof.pdf', { type: 'application/pdf' })); form.set('exam_type', 'kenntnispruefung'); form.set('attempt_date', '2026-10-11');
  return new NextRequest('https://fixture.invalid/api/puyp/submit', { method: 'POST', body: form });
};
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' }); mocks.completion.mockResolvedValue({ pct: 75 }); mocks.eligible.mockReturnValue(true); mocks.gate.mockReturnValue(true); });
describe('proof replay and concurrent storage retry', () => {
  it('timeout replay returns original acknowledgement without uploading again', async () => {
    const fake = createFakeSupabase(() => ({ data: { id: action, result: 'fail', qbank_completion_pct: 75 } })); mocks.client.mockReturnValue(fake.sb);
    expect(await (await POST(request())).json()).toMatchObject({ ok: true, attempt_id: action, duplicate: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].filters).toContainEqual({ kind: 'eq', column: 'user_id', value: 'synthetic-owner' });
  });
  it('invalid action key fails before storage or lookup', async () => {
    const fake = createFakeSupabase(() => ({})); mocks.client.mockReturnValue(fake.sb);
    expect((await POST(request('../../wrong'))).status).toBe(400); expect(fake.calls).toHaveLength(0);
  });
  it('storage duplicate and row race return the winner without deleting its proof', async () => {
    let reads = 0;
    const fake = createFakeSupabase(call => {
      if (call.table === 'exam_attempts' && call.op === 'select') return { data: ++reads === 1 ? null : { id: action, result: 'fail', qbank_completion_pct: 75 } };
      if (call.table === 'exam_attempts' && call.op === 'insert') return { error: { code: '23505' } };
      if (call.table === 'users') return { data: { active_exam: 'kenntnispruefung', exam_date: '2026-10-11' } };
      if (call.table === 'subscriptions') return { data: { id: 'synthetic-sub', tier: 'exam_cohort', puyp_extensions_used: 0 } };
      return {};
    });
    const upload = vi.fn().mockResolvedValue({ error: { statusCode: '409' } }); const remove = vi.fn();
    const sb = { ...fake.sb, storage: { from: () => ({ upload, remove }) } }; mocks.client.mockReturnValue(sb);
    expect(await (await POST(request())).json()).toMatchObject({ ok: true, duplicate: true, attempt_id: action });
    expect(upload.mock.calls[0][0]).toBe(`synthetic-owner/${action}.pdf`); expect(remove).not.toHaveBeenCalled();
    expect(fake.calls.filter(call => call.table === 'user_events')).toHaveLength(0);
  });
});
