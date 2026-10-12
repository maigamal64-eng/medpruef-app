import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyAuthFailure, classifyAuthResponse, validateLogin } from '@/lib/login-errors';
import { exchangeTelegramToken } from '@/lib/telegram-token-exchange';
import { goalPaceLine, goalTierKey } from '@/lib/onboarding-goal';
import { verifyContent } from '@/lib/verify-email-content';
import { HOME_CTA_SLOTS } from '@/lib/home-events';
import { isAllowedEvent, sanitizeEventData } from '@/lib/analytics-events';

beforeAll(() => vi.stubGlobal('React', React));
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('UX-ONB-12 auth outcome map', () => {
  it('maps every status to a kind with a recovery', () => {
    expect(classifyAuthResponse(401, { error: 'Invalid credentials' }).kind).toBe('invalid');
    expect(classifyAuthResponse(401, { error: 'This account uses Telegram login' }).kind).toBe('telegram_only');
    expect(classifyAuthResponse(409, { error: 'Email already registered' }).kind).toBe('exists');
    expect(classifyAuthResponse(429, { retryAfter: 42 })).toEqual({ kind: 'rate_limited', retryAfter: 42 });
    expect(classifyAuthResponse(429, {}).retryAfter).toBe(60);
    expect(classifyAuthResponse(400, {}).kind).toBe('validation');
    expect(classifyAuthResponse(502, 'oops').kind).toBe('unknown');
    expect(classifyAuthFailure(new DOMException('t', 'TimeoutError'), true).kind).toBe('timeout');
    expect(classifyAuthFailure(new TypeError('x'), false).kind).toBe('offline');
  });
  it('UX-ONB-13 validates before any request', () => {
    expect(validateLogin('register', { firstName: '', email: 'x', password: '123' })).toEqual({ firstName: 'a22_login_need_name', email: 'a22_login_bad_email', password: '[secret]' });
    expect(validateLogin('login', { firstName: '', email: 'user-65abd062@example.com', password: 'x' })).toEqual({});
  });
});

describe('UX-ONB-22 Telegram token exchange', () => {
  const sleep = async () => {};
  it('ok returns the session', async () => {
    const r = await exchangeTelegramToken('t', async () => res(200, { user: { id: 'u' }, sessionToken: 's' }), { sleep });
    expect(r.kind).toBe('ok');
  });
  it('a rejected token is permanent and reported once', async () => {
    const fetcher = vi.fn(async () => res(401, { error: 'Token expired' }));
    const r = await exchangeTelegramToken('t', fetcher, { sleep });
    expect(r).toMatchObject({ kind: 'rejected', reason: 'expired_or_used' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('network failures retry with backoff and never claim expiry', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('offline'); });
    const r = await exchangeTelegramToken('t', fetcher, { sleep });
    expect(r.kind).toBe('network');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('a 5xx retries and a later success wins', async () => {
    let n = 0;
    const r = await exchangeTelegramToken('t', async () => (++n < 2 ? res(503, {}) : res(200, { user: {}, sessionToken: 's' })), { sleep });
    expect(r.kind).toBe('ok');
  });
});

describe('UX-ONB-31 goal pace', () => {
  const now = new Date(2026, 9, 12);
  it('tiers', () => {
    expect(goalTierKey(10)).toBe('a22_goal_tier_start');
    expect(goalTierKey(25)).toBe('a22_goal_tier_steady');
    expect(goalTierKey(50)).toBe('a22_goal_tier_short');
    expect(goalTierKey(80)).toBe('a22_goal_tier_intense');
  });
  it('no date, past date and a split hint above the highest preset', () => {
    expect(goalPaceLine({ examDate: null, total: 1000, now, lang: 'de' })).toContain('Setzen Sie ein Datum');
    expect(goalPaceLine({ examDate: '2026-10-12', total: 1000, now, lang: 'de' })).toContain('heute oder vorbei');
    const line = goalPaceLine({ examDate: '2026-10-22', total: 7000, now, lang: 'de' });
    expect(line).toContain('etwa 700 pro Tag');
    expect(line).toContain('mehrere kurze Einheiten');
    expect(goalPaceLine({ examDate: '2026-10-22', total: null, now, lang: 'de' })).toBeNull();
  });
});

describe('UX-ONB-40 verify-email exits', () => {
  const ctx = { linkedEmail: 'user-65abd062@example.com', signInHref: '/login?next=%2Fsettings', continueHref: '/' };
  it('signed out success sends to sign in and says the session is elsewhere', () => {
    const c = verifyContent('success', 'de', { ...ctx, signedIn: false });
    expect(c.title).toBe('Bestätigt: user-65abd062@example.com');
    expect(c.ctaHref).toBe(ctx.signInHref);
    expect(c.extra).toContain('dieses Fenster schließen');
  });
  it('signed in success continues studying', () => {
    expect(verifyContent('success', 'de', { ...ctx, signedIn: true })).toMatchObject({ ctaHref: '/', ctaLabel: 'Weiterlernen' });
  });
  it('expired without session goes to sign in, never claims linked', () => {
    const c = verifyContent('token_expired', 'de', { ...ctx, signedIn: false, linkedEmail: null });
    expect(c.ctaHref).toBe(ctx.signInHref);
    expect(c.title).not.toMatch(/Bestätigt/);
  });
});

describe('UX-HOME-53 measurement', () => {
  it('home_cta is allowlisted with an enumerated slot and no personal data', () => {
    expect(isAllowedEvent('home_cta')).toBe(true);
    expect(HOME_CTA_SLOTS).toContain('hero_study');
    expect(sanitizeEventData('home_cta', { slot: 'topic', exam: 'pharma', email: 'user-65abd062@example.com', userId: 'x' })).toEqual({ slot: 'topic', exam: 'pharma' });
    for (const e of ['tg_token_failed', 'banner_dismissed', 'onboarding_save_failed', 'onboarding_skip', 'pwa_coach_shown']) expect(isAllowedEvent(e)).toBe(true);
  });
});
