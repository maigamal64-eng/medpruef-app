import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase } from '../helpers/fake-supabase';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), admin: vi.fn(), client: vi.fn(), completion: vi.fn(), eligible: vi.fn(), gate: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard, requireAdmin: mocks.admin }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
vi.mock('@/lib/sentry-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/nowpayments', () => ({ isPuypEligibleTier: mocks.eligible }));
vi.mock('@/lib/puyp', () => ({ computeQbankCompletion: mocks.completion, meetsPuypCompletionGate: mocks.gate, PUYP_COMPLETION_THRESHOLD_PCT: 70, PUYP_MAX_EXTENSIONS: 2 }));

import { POST as RESULT } from '@/app/api/puyp/result/route';
import { GET as STATUS } from '@/app/api/puyp/status/route';
import { GET as ADMIN_QUEUE } from '@/app/api/puyp/admin/route';
import { NextResponse } from 'next/server';
import { suggestPuypExtension } from '@/lib/exam-dates';
import { permissionForAdminRequest } from '@/lib/admin/permissions';

const key = '00000000-0000-4000-8000-000000000a24';
const failReq = (body: Record<string, unknown> = {}) => new NextRequest('https://fixture.invalid/api/puyp/result', {
  method: 'POST', body: JSON.stringify({ result: 'fail', exam_type: 'kenntnispruefung', attempt_date: '2026-10-01', idempotency_key: key, ...body }),
});
const user = { data: { active_exam: 'kenntnispruefung', exam_date: '2026-10-01' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' });
  mocks.completion.mockResolvedValue({ pct: 41.2, answered: 10, total: 20 });
  mocks.eligible.mockReturnValue(true);
  mocks.gate.mockReturnValue(true);
});

describe('POST /api/puyp/result fail without proof (pick-ux-exm-46 A)', () => {
  it('requires a client action key', async () => {
    const fake = createFakeSupabase(() => ({})); mocks.client.mockReturnValue(fake.sb);
    expect((await RESULT(failReq({ idempotency_key: 'nope' }))).status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
  it('stores one user_events row and never an exam_attempts row (stays out of the admin queue)', async () => {
    const fake = createFakeSupabase(call => (call.table === 'users' ? user : {})); mocks.client.mockReturnValue(fake.sb);
    const res = await RESULT(failReq());
    expect(await res.json()).toEqual({ ok: true, result: 'fail', with_proof: false });
    expect(fake.calls.some(c => c.table === 'exam_attempts')).toBe(false);
    const insert = fake.calls.find(c => c.op === 'insert');
    expect(insert?.table).toBe('user_events');
    expect(insert?.payload).toMatchObject({ user_id: 'synthetic-owner', event_type: 'puyp_result_recorded', event_data: { outcome: 'fail', with_proof: false, idempotency_key: key, exam_type: 'kenntnispruefung', attempt_date: '2026-10-01' } });
    const lookup = fake.calls.find(c => c.table === 'user_events' && c.op === 'select');
    expect(lookup?.filters).toContainEqual({ kind: 'eq', column: 'event_data->>idempotency_key', value: key });
    expect(lookup?.filters).toContainEqual({ kind: 'eq', column: 'user_id', value: 'synthetic-owner' });
  });
  it('a retry with the same key returns the first record without a second write', async () => {
    const fake = createFakeSupabase(call => (call.table === 'users' ? user : call.table === 'user_events' ? { data: { id: 7 } } : {}));
    mocks.client.mockReturnValue(fake.sb);
    expect(await (await RESULT(failReq())).json()).toMatchObject({ ok: true, duplicate: true, result: 'fail' });
    expect(fake.calls.filter(c => c.op === 'insert')).toHaveLength(0);
  });
  it('fails closed when the prior read or the write fails', async () => {
    const readFail = createFakeSupabase(call => (call.table === 'users' ? user : { error: { code: '57014' } }));
    mocks.client.mockReturnValue(readFail.sb);
    expect((await RESULT(failReq())).status).toBe(500);
    expect(readFail.calls.filter(c => c.op === 'insert')).toHaveLength(0);
    const writeFail = createFakeSupabase(call => (call.table === 'users' ? user : call.op === 'insert' ? { error: { code: '23503' } } : {}));
    mocks.client.mockReturnValue(writeFail.sb);
    expect((await RESULT(failReq())).status).toBe(500);
  });
  it('rejects other results', async () => {
    const fake = createFakeSupabase(() => ({})); mocks.client.mockReturnValue(fake.sb);
    expect((await RESULT(failReq({ result: 'maybe' }))).status).toBe(400);
  });
});

describe('GET /api/puyp/status reason codes (UX-EXM-46)', () => {
  const req = () => new NextRequest('https://fixture.invalid/api/puyp/status');
  it('no plan, ineligible tier and cap carry a reason_code; no 12-month plan is named', async () => {
    for (const [sub, eligibleTier, code] of [
      [null, true, 'no_subscription'],
      [{ tier: 'monthly', expires_at: null, puyp_extensions_used: 0 }, false, 'tier_not_eligible'],
      [{ tier: 'premium_pass_guaranteed', expires_at: null, puyp_extensions_used: 2 }, true, 'cap_reached'],
    ] as const) {
      mocks.eligible.mockReturnValue(eligibleTier);
      const fake = createFakeSupabase(call => (call.table === 'users' ? user : call.table === 'subscriptions' ? { data: sub } : {}));
      mocks.client.mockReturnValue(fake.sb);
      const body = await (await STATUS(req())).json();
      expect(body).toMatchObject({ eligible: false, reason_code: code });
      expect(body.reason).not.toMatch(/12-month/i);
    }
  });
  it('an eligible learner has no reason_code', async () => {
    const fake = createFakeSupabase(call => (call.table === 'users' ? user : call.table === 'subscriptions' ? { data: { tier: 'premium_pass_guaranteed', expires_at: null, puyp_extensions_used: 1 } } : {}));
    mocks.client.mockReturnValue(fake.sb);
    const body = await (await STATUS(req())).json();
    expect(body).toMatchObject({ eligible: true, meets_completion_gate: true });
    expect(body.reason_code).toBeUndefined();
  });
  it('a failed subscription read is an error, never "no plan"', async () => {
    const fake = createFakeSupabase(call => (call.table === 'users' ? user : call.table === 'subscriptions' ? { error: { code: '57014' } } : {}));
    mocks.client.mockReturnValue(fake.sb);
    expect((await STATUS(req())).status).toBe(500);
  });
});

describe('GET /api/puyp/admin suggested access end (n-api-01)', () => {
  const req = () => new NextRequest('https://fixture.invalid/api/puyp/admin?status=pending');
  const attempt = (id: string, exam_type: string) => ({
    id, user_id: 'synthetic-learner', subscription_id: null, exam_type, attempt_date: '2026-09-30', result: 'fail',
    proof_url: null, verified_at: null, verified_by: null, rejection_reason: null, qbank_completion_pct: 80,
    created_at: '2026-10-12T08:00:00Z', users: null, subscriptions: null,
  });
  const queue = (rows: unknown[]) => {
    const fake = createFakeSupabase(call => (call.table === 'exam_attempts' ? { data: rows } : {}));
    mocks.client.mockReturnValue(fake.sb);
    return fake;
  };
  beforeEach(() => { mocks.admin.mockResolvedValue({ userId: 'synthetic-admin', role: 'admin', tier: 'admin' }); });
  afterEach(() => { vi.useRealTimers(); });

  it('equals suggestPuypExtension for an exam with a published sitting; Stichprobentest needs a manual date', async () => {
    const now = new Date('2026-10-13T10:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    queue([attempt('a1', 'kenntnispruefung'), attempt('a2', 'pharma'), attempt('a3', 'kmp_innsbruck')]);
    const body = await (await ADMIN_QUEUE(req())).json();
    const byId = Object.fromEntries(body.items.map((i: { id: string }) => [i.id, i]));
    for (const id of ['a1', 'a2']) {
      const expected = suggestPuypExtension(byId[id].exam_type, now);
      expect(expected).not.toBeNull();
      expect(byId[id]).toMatchObject({ suggested_expires_at: expected!.toISOString(), suggested_reason: 'default' });
    }
    expect(byId.a3).toMatchObject({ suggested_expires_at: null, suggested_reason: 'set_date_manually' });
  });

  it('is null plus set_date_manually when no sitting is published, and for an unknown exam', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    queue([attempt('b1', 'kenntnispruefung'), attempt('b2', 'pharma'), attempt('b3', 'unknown_exam')]);
    const body = await (await ADMIN_QUEUE(req())).json();
    for (const item of body.items) expect(item).toMatchObject({ suggested_expires_at: null, suggested_reason: 'set_date_manually' });
  });

  it('adds only the two suggestion fields to each row', async () => {
    const row = attempt('c1', 'kenntnispruefung');
    queue([row]);
    const body = await (await ADMIN_QUEUE(req())).json();
    const added = Object.keys(body.items[0]).filter(k => !(k in row)).sort();
    expect(added).toEqual(['due_in_hours', 'learner_notified', 'proof_signed_url', 'suggested_expires_at', 'suggested_reason']);
  });

  it('still answers 403 without revenue.read and reads nothing', async () => {
    expect(permissionForAdminRequest('/api/puyp/admin', 'GET')).toBe('revenue.read');
    mocks.admin.mockResolvedValue({ error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) });
    const fake = queue([attempt('d1', 'kenntnispruefung')]);
    expect((await ADMIN_QUEUE(req())).status).toBe(403);
    expect(fake.calls).toHaveLength(0);
  });
});
