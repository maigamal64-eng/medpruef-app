import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), insert: vi.fn(), upsert: vi.fn(), single: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: m.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: m.client }));
vi.mock('@/lib/sentry-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/supabase-resilience', () => ({ analyticsWritesDisabled: () => false }));
import { POST } from '@/app/api/track/route';
const request = (createSession = true) => new NextRequest('https://medpruf.com/api/track', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': 'signed-a' },
  body: JSON.stringify({ userId: 'account-b', sessionId: 'visit-a', createSession, events: [{ type: 'page_view', timestamp: new Date().toISOString(), data: { page: '/quiz?userId=account-b' } }] }),
});
beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ userId: 'account-a' });
  m.single.mockResolvedValue({ data: { user_id: 'account-a' }, error: null });
  m.insert.mockResolvedValue({ error: null }); m.upsert.mockResolvedValue({ error: null });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: m.single, single: m.single, update: vi.fn(() => chain), upsert: m.upsert, insert: m.insert };
  m.client.mockReturnValue({ from: () => chain });
});
describe('telemetry account identity and visit ownership', () => {
  it('ignores a substituted body ID and writes only the signed account', async () => {
    const res = await POST(request()); expect(res.status).toBe(200);
    expect(m.upsert.mock.calls[0][0].user_id).toBe('account-a');
    expect(m.upsert.mock.calls[0][1]).toMatchObject({ ignoreDuplicates: true });
    expect(m.insert.mock.calls[0][0][0]).toMatchObject({ user_id: 'account-a', event_data: { page: '/quiz' } });
  });
  it('refuses a visit already owned by another account without inserting events', async () => {
    m.single.mockResolvedValue({ data: { user_id: 'account-b' }, error: null });
    const res = await POST(request(false)); expect(res.status).toBe(403); expect(m.insert).not.toHaveBeenCalled();
  });
  it('requires a signed session before any database operation', async () => {
    m.guard.mockResolvedValue({ error: NextResponse.json({ error: 'Missing session' }, { status: 401 }) });
    expect((await POST(request())).status).toBe(401); expect(m.client).not.toHaveBeenCalled();
  });
});
