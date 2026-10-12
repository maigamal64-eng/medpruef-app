import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionGate, confirmedUnmatchedPayment, PAYMENT_CHECK_CEILING_MS, safeCheckoutReference } from '@/lib/account-request';
import { pendingCheckout } from '@/lib/checkout-pending';
import { createFeedbackSubmission } from '@/lib/checkout-feedback-submit';
import { t } from '@/lib/i18n';

afterEach(() => vi.useRealTimers());
describe('payment verification action guard', () => {
  it('shares same-tick visibility/pageshow/manual guard and ten-second cooldown', () => {
    vi.useFakeTimers();
    const gate = createActionGate(10_000);
    expect(gate.enter()).toBe(true); expect(gate.enter()).toBe(false);
    gate.leave(); expect(gate.enter()).toBe(false);
    vi.advanceTimersByTime(9_999); expect(gate.enter()).toBe(false);
    vi.advanceTimersByTime(1); expect(gate.enter()).toBe(true);
    vi.advanceTimersByTime(20_000); expect(gate.enter()).toBe(false);
    gate.leave(); expect(gate.enter()).toBe(true);
    expect(PAYMENT_CHECK_CEILING_MS).toBe(900_000);
  });
  it('unmatched without a provider payment reference never acknowledges a payment', () => {
    expect(confirmedUnmatchedPayment({ reason: 'payment_unmatched', payment_ref: null })).toBe(false);
    expect(confirmedUnmatchedPayment({ reason: 'payment_unmatched', payment_ref: 'pay_fixture' })).toBe(true);
    expect(confirmedUnmatchedPayment({ reason: 'payment_not_found', payment_ref: 'pay_fixture' })).toBe(false);
    expect(safeCheckoutReference(new URLSearchParams('session=ch_fixture'))).toBe('ch_fixture');
    expect(safeCheckoutReference(new URLSearchParams('session=<script>'))).toBeNull();
  });
});
describe('pending checkout events', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const redirect = { event: 'checkout_redirected', created_at: '2026-10-11T11:55:00Z', tier: 'first_month_19' };
  it('refuses a recent second checkout and uses a 24h strip window without settlement inference', () => {
    expect(pendingCheckout([redirect], now)).toEqual(redirect);
    expect(pendingCheckout([redirect], now + 31 * 60_000)).toBeNull();
    expect(pendingCheckout([redirect], now + 31 * 60_000, 86_400_000)).toEqual(redirect);
    expect(pendingCheckout([redirect], now + 86_400_000, 86_400_000)).toBeNull();
    expect(pendingCheckout([redirect], now - 600_000)).toBeNull();
  });
  it('only a later grant or verified no-payment check for that tier releases pending', () => {
    expect(pendingCheckout([redirect, { ...redirect, event: 'grant_succeeded', created_at: '2026-10-11T11:56:00Z' }], now)).toBeNull();
    const absent = { ...redirect, event: 'checkout_failed', created_at: '2026-10-11T11:56:00Z', reason: 'verified_payment_not_found' };
    expect(pendingCheckout([redirect, absent], now)).toBeNull();
    expect(pendingCheckout([redirect, { ...absent, tier: 'first_3mo_27' }], now)).toEqual(redirect);
    expect(pendingCheckout([redirect, { ...absent, reason: 'provider_error' }], now)).toEqual(redirect);
  });
});
describe('checkout stall feedback', () => {
  it('other_reason_send_posts_typed_text', async () => {
    const post = vi.fn(async () => new Response('{}', { status: 200 })); const submit = createFeedbackSubmission(post);
    expect(await submit.send('other', '  My reason  ', '/')).toBe('saved');
    expect(post).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledWith({ reason: 'other', details: 'My reason', url: '/' });
  });
  it('failed_reason_post_retains_text_and_shows_error', async () => {
    const post = vi.fn(async () => new Response('{}', { status: 500 })); const submit = createFeedbackSubmission(post);
    const text = 'My reason'; expect(await submit.send('other', text, '/')).toBe('failed');
    expect(post.mock.calls[0][0].details).toBe(text); expect(submit.pending()).toBe(false);
    expect(t('checkout_stall_failed', 'de')).toContain('Nicht gesendet');
  });
  it('pending_reason_post_ignores_duplicate_send', async () => {
    let finish!: (value: Response) => void;
    const post = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); const submit = createFeedbackSubmission(post);
    const first = submit.send('other', 'typed');
    expect(submit.pending()).toBe(true); expect(await submit.send('other', 'typed')).toBe('pending'); expect(post).toHaveBeenCalledTimes(1);
    finish(new Response('{}', { status: 200 })); expect(await first).toBe('saved');
  });
});
it.each(['ru', 'uk', 'ar', 'tr'] as const)('new account copy falls back to reviewed English for %s', lang => {
  expect(t('account_do_not_pay_again', lang)).toBe(t('account_do_not_pay_again', 'en'));
  expect(t('account_trial_limit', lang)).toBe(t('account_trial_limit', 'en'));
});
