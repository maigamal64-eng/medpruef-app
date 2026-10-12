import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ guard: vi.fn(), optional: vi.fn(), client: vi.fn(), rpc: vi.fn(), eq: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: m.guard, requireAdmin: vi.fn(), resolveOptionalUser: m.optional, isFreeAccess: () => false }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: m.client }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => 'fixture', rateLimitHeaders: () => ({}), callerIdentity: () => 'fixture' }));
vi.mock('@/lib/sentry-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/admin/audit', () => ({ logAdminAction: vi.fn(), resolveActorEmail: vi.fn() }));
vi.mock('@/lib/free-access', () => ({ canFreeUserReadQuestion: vi.fn(), logFreeCapHit: vi.fn() }));
vi.mock('@/lib/free-tier', () => ({ getTopicCountsCached: () => ({ data: [], error: null }) }));
vi.mock('@/lib/referral-exam-reward', () => ({ qualifyReferralOnActivity: vi.fn() }));
import { GET as stats } from '@/app/api/stats/route';
import { GET as progress } from '@/app/api/user/topic-progress/route';
import { POST as answer } from '@/app/api/answer/route';
import { POST as suggestion } from '@/app/api/suggestions/route';

beforeEach(() => {
  vi.clearAllMocks(); m.guard.mockResolvedValue({ userId: 'signed-account-a', tier: 'pro' }); m.optional.mockReturnValue('signed-account-a');
  m.rpc.mockImplementation(async name => ({ data: name === 'record_quiz_answer' ? { saved: true, duplicate: true } : [], error: null }));
  const chain = { select: vi.fn(() => chain), eq: m.eq.mockImplementation(() => chain), maybeSingle: vi.fn(async () => ({ data: { id: 'signed-account-a', topic: 'Fixture', exam_type: 'pharma' }, error: null })), single: vi.fn(async () => ({ data: { id: 42 }, error: null })), insert: m.insert.mockImplementation(() => chain) };
  m.client.mockReturnValue({ from: () => chain, rpc: m.rpc });
});
const get = (path: string) => new NextRequest(`https://medpruf.com${path}?userId=other-account-b&examType=pharma`, { headers: { 'x-session-token': 'fixture-signed-a', 'x-user-id': 'other-account-b' } });
const post = (path: string, data: Record<string, unknown>) => new NextRequest(`https://medpruf.com${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-token': 'fixture-signed-a', 'x-user-id': 'other-account-b' }, body: JSON.stringify({ ...data, userId: 'other-account-b' }) });
describe('HOME-52a separate substituted account request audit', () => {
  it('stats query/header substitution reads only the signed account', async () => {
    expect((await stats(get('/api/stats'))).status).toBe(200);
    expect(m.eq).toHaveBeenCalledWith('user_id', 'signed-account-a');
    expect(m.rpc).toHaveBeenCalledWith('get_user_topic_stats', { p_user_id: 'signed-account-a' });
  });
  it('topic progress substitution scopes both RPCs to the signed account', async () => {
    expect((await progress(get('/api/user/topic-progress'))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('get_user_topic_progress', { p_user_id: 'signed-account-a', p_exam_type: 'pharma' });
    expect(m.rpc).toHaveBeenCalledWith('get_user_topic_attempt_stats', { p_user_id: 'signed-account-a', p_exam_type: 'pharma' });
  });
  it('answer body/header substitution can record an answer only for the signed account', async () => {
    expect((await answer(post('/api/answer', { questionId: 42, isCorrect: true }))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('record_quiz_answer', expect.objectContaining({ p_user_id: 'signed-account-a' }));
    expect(m.rpc.mock.calls.some(call => call[1]?.p_user_id === 'other-account-b')).toBe(false);
  });
  it('suggestion body substitution attaches only the verified account', async () => {
    expect((await suggestion(post('/api/suggestions', { questionId: 42, type: 'flag', reason: 'fixture' }))).status).toBe(200);
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'signed-account-a' }));
  });
  it('unsigned suggestion cannot impersonate the body ID, which is only unprivileged context', async () => {
    m.optional.mockReturnValue(null);
    expect((await suggestion(post('/api/suggestions', { questionId: 42, type: 'flag' }))).status).toBe(200);
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null, context: expect.objectContaining({ guest_id: 'other-account-b' }) }));
  });
  it('unsigned read/write attempts reach no study database operation', async () => {
    m.guard.mockResolvedValue({ error: NextResponse.json({ error: 'Missing session' }, { status: 401 }) });
    expect((await stats(get('/api/stats'))).status).toBe(401);
    expect((await progress(get('/api/user/topic-progress'))).status).toBe(401);
    expect((await answer(post('/api/answer', { questionId: 42, isCorrect: true }))).status).toBe(401);
    expect(m.client).not.toHaveBeenCalled();
  });
});
