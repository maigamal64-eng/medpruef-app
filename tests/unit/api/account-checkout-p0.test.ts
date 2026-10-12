import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase, eqVal } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), create: vi.fn(), log: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
vi.mock('@/lib/whop', () => ({ tierToWhopPlan: () => 'plan_fixture', createWhopCheckoutSession: mocks.create, TIERS: { first_month_19: { priceCents: 1900 } } }));
vi.mock('@/lib/paymentEvents', () => ({ logPaymentEvent: mocks.log }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
import { POST } from '@/app/api/whop/checkout/route';
import { GET } from '@/app/api/whop/checkout/status/route';
const request = () => new NextRequest('https://medpruf.com/api/whop/checkout', { method: 'POST', body: JSON.stringify({ tier: 'first_month_19' }) });
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' }); mocks.log.mockResolvedValue(undefined); });
describe('signed pending checkout protection', () => {
  it('rejects a second session for recent redirected/no grant', async () => {
    const fake = createFakeSupabase(call => call.table === 'users' ? { data: { tier: 'free', role: 'user', tier_expires_at: null } } : { data: [{ event: 'checkout_redirected', tier: 'first_month_19', created_at: new Date().toISOString() }] }); mocks.client.mockReturnValue(fake.sb);
    const response = await POST(request()); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'CHECKOUT_PENDING' }); expect(mocks.create).not.toHaveBeenCalled();
    expect(fake.calls.find(call => call.table === 'payment_events')?.limit).toBe(100);
  });
  it('rejects already paid and refuses checkout on a failed account read', async () => {
    const fake = createFakeSupabase(() => ({ data: { tier: 'pro', role: 'user', tier_expires_at: '2099-01-01' } })); mocks.client.mockReturnValue(fake.sb);
    expect((await POST(request())).status).toBe(409); expect(mocks.create).not.toHaveBeenCalled();
    mocks.client.mockReturnValue(createFakeSupabase(() => ({ error: { message: 'failure' } })).sb);
    expect((await POST(request())).status).toBe(503); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('pending status is bounded, account scoped and never makes a receipt', async () => {
    const fake = createFakeSupabase(() => ({ data: [{ event: 'checkout_redirected', tier: 'first_month_19', checkout_session_id: 'ch_fixture', created_at: new Date().toISOString() }] })); mocks.client.mockReturnValue(fake.sb);
    const response = await GET(new NextRequest('https://medpruf.com/api/whop/checkout/status?userId=other'));
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.json()).toMatchObject({ pending: { tier: 'first_month_19', reference: 'ch_fixture' } });
    expect(eqVal(fake.calls[0], 'user_id')).toBe('synthetic-owner'); expect(fake.calls[0].limit).toBe(100); expect(fake.calls.every(call => call.op === 'select')).toBe(true);
  });
});
