import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase, eqVal } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), create: vi.fn(), log: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.client }));
vi.mock('@/lib/whop', () => ({ tierToWhopPlan: () => 'plan_fixture', createWhopCheckoutSession: mocks.create, TIERS: { first_month_19: { priceCents: 1900 } } }));
vi.mock('@/lib/paymentEvents', () => ({ logPaymentEvent: mocks.log }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('@/lib/whop-subscription-snapshot', async (orig) => ({ ...(await orig<typeof import('@/lib/whop-subscription-snapshot')>()), loadWhopBillingSnapshot: mocks.snapshot }));
import { POST } from '@/app/api/whop/checkout/route';
import { GET } from '@/app/api/whop/checkout/status/route';
const request = () => new NextRequest('https://medpruf.com/api/whop/checkout', { method: 'POST', body: JSON.stringify({ tier: 'first_month_19' }) });
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: 'synthetic-owner' }); mocks.log.mockResolvedValue(undefined); mocks.snapshot.mockResolvedValue(null); vi.stubEnv('WHOP_EXTENSIONS_ENABLED', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); });
describe('signed pending checkout protection', () => {
  it('rejects a second session for recent redirected/no grant', async () => {
    const fake = createFakeSupabase(call => call.table === 'users' ? { data: { tier: 'free', role: 'user', tier_expires_at: null } } : { data: [{ event: 'checkout_redirected', tier: 'first_month_19', created_at: new Date().toISOString() }] }); mocks.client.mockReturnValue(fake.sb);
    const response = await POST(request()); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'CHECKOUT_PENDING' }); expect(mocks.create).not.toHaveBeenCalled();
    expect(fake.calls.find(call => call.table === 'payment_events')?.limit).toBe(100);
  });
  it('refuses admins and open-ended access, and checkout on a failed account read', async () => {
    mocks.client.mockReturnValue(createFakeSupabase(() => ({ data: { tier: 'pro', role: 'admin', tier_expires_at: '2099-01-01' } })).sb);
    expect(await (await POST(request())).json()).toMatchObject({ code: 'ALREADY_PRO' }); expect(mocks.create).not.toHaveBeenCalled();
    mocks.client.mockReturnValue(createFakeSupabase(call => call.table === 'users' ? { data: { tier: 'pro', role: 'user', tier_expires_at: null } } : { data: [] }).sb);
    expect(await (await POST(request())).json()).toMatchObject({ code: 'ALREADY_PRO' }); expect(mocks.create).not.toHaveBeenCalled();
    mocks.client.mockReturnValue(createFakeSupabase(() => ({ error: { message: 'failure' } })).sb);
    expect((await POST(request())).status).toBe(503); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('lets active one-time Pro extend from the current end date', async () => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    mocks.create.mockResolvedValue({ id: 'ch_fixture', purchaseUrl: 'https://whop.example/checkout' });
    const fake = createFakeSupabase(call => {
      if (call.table === 'users') return { data: { tier: 'pro', role: 'user', tier_expires_at: end, email: null } };
      if (call.table === 'subscriptions' && call.columns === 'expires_at') return { data: [{ expires_at: end }] };
      if (call.table === 'subscriptions') return { data: [{ tier: 'premium_pass_guaranteed', payment_provider: 'whop', provider_payment_id: 'pay_old' }] };
      if (call.table === 'payment_events' && call.columns?.includes('plan_id')) return { data: [{ payment_id: 'pay_old', plan_id: 'plan_redacted324decbc' }] };
      return { data: [] };
    });
    mocks.client.mockReturnValue(fake.sb);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchaseUrl: 'https://whop.example/checkout', extendsFrom: end });
    expect(mocks.create.mock.calls[0][0].redirectUrl).toContain(`extends_from=${encodeURIComponent(end)}`);
  });
  it('says ALREADY_RENEWING only when Whop confirms the plan renews by itself', async () => {
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const trialRow = { tier: 'notes_pro_trial', payment_provider: 'whop', provider_payment_id: null, whop_membership_id: 'mem_fixture' };
    const withRows = (rows: unknown) => createFakeSupabase(call => call.table === 'users' ? { data: { tier: 'pro', role: 'user', tier_expires_at: end } } : call.table === 'subscriptions' ? { data: rows } : { data: [] }).sb;
    const verified = { provider_state_verified: true, billing_cadence: 'auto_renews', cancel_at_period_end: false, provider_status: 'trialing', next_charge_at: end };
    mocks.snapshot.mockResolvedValue(verified);
    mocks.client.mockReturnValue(withRows([trialRow]));
    let response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'ALREADY_RENEWING' });
    expect(mocks.snapshot).toHaveBeenCalledWith('mem_fixture', 'notes_pro_trial');
    // Not verified: a failed membership read, an unknown plan, a failed table read.
    mocks.snapshot.mockResolvedValue(null);
    for (const rows of [[trialRow], [{ tier: 'first_month_19', payment_provider: 'whop', provider_payment_id: null, whop_membership_id: null }]]) {
      mocks.client.mockReturnValue(withRows(rows));
      response = await POST(request());
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'PLAN_UNVERIFIED' });
    }
    mocks.client.mockReturnValue(createFakeSupabase(call => call.table === 'users' ? { data: { tier: 'pro', role: 'user', tier_expires_at: end } } : { error: { message: 'down' } }).sb);
    response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'PLAN_UNVERIFIED' });
    // Paused collection or no next charge date: not a verified renewal either.
    mocks.snapshot.mockResolvedValue({ ...verified, next_charge_at: null });
    mocks.client.mockReturnValue(withRows([trialRow]));
    expect(await (await POST(request())).json()).toMatchObject({ code: 'PLAN_UNVERIFIED' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('a renewing plan cancelled at Whop is never called renewing; extensions stay off by default', async () => {
    vi.stubEnv('WHOP_EXTENSIONS_ENABLED', '');
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
    mocks.snapshot.mockResolvedValue({ provider_state_verified: true, billing_cadence: 'auto_renews', cancel_at_period_end: true, provider_status: 'canceling', next_charge_at: null });
    mocks.client.mockReturnValue(createFakeSupabase(call => {
      if (call.table === 'users') return { data: { tier: 'pro', role: 'user', tier_expires_at: end } };
      if (call.table === 'subscriptions' && call.columns === 'expires_at') return { data: [{ expires_at: end }] };
      if (call.table === 'subscriptions') return { data: [{ tier: 'notes_pro_trial', payment_provider: 'whop', provider_payment_id: null, whop_membership_id: 'mem_fixture' }] };
      return { data: [] };
    }).sb);
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'EXTENSION_UNAVAILABLE' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('pending status is bounded, account scoped and never makes a receipt', async () => {
    const fake = createFakeSupabase(() => ({ data: [{ event: 'checkout_redirected', tier: 'first_month_19', checkout_session_id: 'ch_fixture', created_at: new Date().toISOString() }] })); mocks.client.mockReturnValue(fake.sb);
    const response = await GET(new NextRequest('https://medpruf.com/api/whop/checkout/status?userId=other'));
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.json()).toMatchObject({ pending: { tier: 'first_month_19', reference: 'ch_fixture' } });
    expect(eqVal(fake.calls[0], 'user_id')).toBe('synthetic-owner'); expect(fake.calls[0].limit).toBe(100); expect(fake.calls.every(call => call.op === 'select')).toBe(true);
  });
  it('refuses an extension that would add no days (access not from the newest Whop row)', async () => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const rowEnds = [[], [{ expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString() }]];
    for (const rows of rowEnds) {
      mocks.client.mockReturnValue(createFakeSupabase(call => {
        if (call.table === 'users') return { data: { tier: 'pro', role: 'user', tier_expires_at: end } };
        if (call.table === 'subscriptions' && call.columns === 'expires_at') return { data: rows };
        if (call.table === 'subscriptions') return { data: [{ tier: 'pro', payment_provider: 'manual', provider_payment_id: null }] };
        return { data: [] };
      }).sb);
      const response = await POST(request());
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'EXTENSION_UNAVAILABLE' });
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps extensions off by default: active Pro gets EXTENSION_UNAVAILABLE, never a checkout', async () => {
    vi.stubEnv('WHOP_EXTENSIONS_ENABLED', '');
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    mocks.client.mockReturnValue(createFakeSupabase(call => {
      if (call.table === 'users') return { data: { tier: 'pro', role: 'user', tier_expires_at: end } };
      if (call.table === 'subscriptions' && call.columns === 'expires_at') return { data: [{ expires_at: end }] };
      if (call.table === 'subscriptions') return { data: [{ tier: 'premium_pass_guaranteed', payment_provider: 'whop', provider_payment_id: 'pay_old' }] };
      if (call.table === 'payment_events' && call.columns?.includes('plan_id')) return { data: [{ payment_id: 'pay_old', plan_id: 'plan_redacted324decbc' }] };
      return { data: [] };
    }).sb);
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'EXTENSION_UNAVAILABLE' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
