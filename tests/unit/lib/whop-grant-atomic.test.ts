import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/paymentEvents', () => ({ logPaymentEvent: vi.fn() }));
import { extendOrInsertWhopSubscription } from '@/lib/whop-grant';
import { createFakeSupabase } from '../helpers/fake-supabase';

const args = { userId: 'synthetic-user', tier: 'first_month_19', paymentId: 'payment-synthetic', amountCents: 1900, currency: 'EUR', membershipId: 'membership-synthetic' };
afterEach(() => vi.unstubAllEnvs());
describe('gated atomic paid Whop grant', () => {
  it('maps the atomic result and passes existing tier duration to one RPC', async () => {
    vi.stubEnv('WHOP_ATOMIC_GRANTS_ENABLED', 'true');
    const rpc = vi.fn().mockResolvedValue({ data: [{ mode: 'extended', subscription_id: 'sub', expires_at: '2040-04-02T00:00:00Z', previous_expires_at: '2040-03-02T00:00:00Z', replayed: true, entitlement_reconciled: true }], error: null });
    const from = vi.fn();
    const result = await extendOrInsertWhopSubscription({ rpc, from } as unknown as SupabaseClient, args);
    expect(result).toMatchObject({ mode: 'extended', subscriptionId: 'sub', expiresAt: '2040-04-02T00:00:00Z', previousExpiresAt: '2040-03-02T00:00:00Z', replayed: true, entitlementReconciled: true });
    expect(rpc).toHaveBeenCalledWith('grant_whop_paid_subscription_pinned', { p_user_id: args.userId, p_tier: args.tier, p_payment_id: args.paymentId, p_amount_cents: 1900, p_currency: 'EUR', p_duration_months: 1, p_membership_id: args.membershipId });
    expect(from).not.toHaveBeenCalled();
  });
  it('fails closed when enabled RPC is absent, without non-atomic fallback', async () => {
    vi.stubEnv('WHOP_ATOMIC_GRANTS_ENABLED', 'true');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC unavailable', code: 'PGRST202' } });
    const from = vi.fn();
    const result = await extendOrInsertWhopSubscription({ rpc, from } as unknown as SupabaseClient, args);
    expect(result).toMatchObject({ mode: 'failed', error: 'RPC unavailable' });
    expect(from).not.toHaveBeenCalled();
  });
  it('fails closed on transport exceptions and malformed RPC results', async () => {
    vi.stubEnv('WHOP_ATOMIC_GRANTS_ENABLED', 'true');
    for (const rpc of [vi.fn().mockRejectedValue(new Error('transport failed')), vi.fn().mockResolvedValue({ data: [{}], error: null })]) {
      const from = vi.fn();
      const result = await extendOrInsertWhopSubscription({ rpc, from } as unknown as SupabaseClient, args);
      expect(result.mode).toBe('failed');
      expect(from).not.toHaveBeenCalled();
    }
  });
  it('keeps the legacy path when the rollout gate is unset', async () => {
    vi.stubEnv('WHOP_ATOMIC_GRANTS_ENABLED', '');
    const fake = createFakeSupabase((call) => call.op === 'insert' ? { data: { id: 'legacy-sub' } } : { data: [] });
    const rpc = vi.fn();
    const result = await extendOrInsertWhopSubscription({ ...fake.sb, rpc } as unknown as SupabaseClient, args);
    expect(result.mode).toBe('inserted');
    expect(rpc).not.toHaveBeenCalled();
  });
});
