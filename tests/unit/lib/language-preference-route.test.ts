import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ guard: vi.fn(), update: vi.fn(), eq: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: m.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: m.client }));
import { PATCH } from '@/app/api/user/language/route';
beforeEach(() => {
  vi.clearAllMocks(); m.guard.mockResolvedValue({ userId: 'signed-account' });
  m.eq.mockResolvedValue({ error: null }); m.update.mockReturnValue({ eq: m.eq });
  m.client.mockReturnValue({ from: () => ({ update: m.update }) });
});
const request = (language: string) => new NextRequest('https://medpruf.com/api/user/language', { method: 'PATCH', body: JSON.stringify({ language, userId: 'substituted-account' }) });
it('writes exactly one explicit preference only for the signed account', async () => {
  expect((await PATCH(request('ru'))).status).toBe(200);
  expect(m.update).toHaveBeenCalledTimes(1); expect(m.update).toHaveBeenCalledWith({ language_code: 'ru' });
  expect(m.eq).toHaveBeenCalledWith('id', 'signed-account');
});
it('rejects unsupported language codes without a database call', async () => {
  expect((await PATCH(request('fr'))).status).toBe(400); expect(m.client).not.toHaveBeenCalled();
});
it('requires a signed session before updating preferences', async () => {
  m.guard.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) });
  expect((await PATCH(request('en'))).status).toBe(401); expect(m.update).not.toHaveBeenCalled();
});
