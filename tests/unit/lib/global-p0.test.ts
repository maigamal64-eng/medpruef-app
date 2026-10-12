import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createSafeStorage } from '@/lib/safe-storage';
import { detectLanguage, LANGUAGE_HEAD_SCRIPT, renderLang } from '@/lib/language-model';
import { persistAuthEntry, readAuthEntry, initialAuthMode, parseAuthEntry, authDestination, safeNext } from '@/lib/auth-entry';
import { buildQuizHref, stripLegacyIdentity } from '@/lib/quiz-links';
import { checkedJson, createRequestSequence, isRecord } from '@/lib/async-data';
import { billingAmount, billingTrialLine, paymentStatusText, VERIFIED_CANCEL_PATH } from '@/lib/billing-copy';
import { pendingCheckout } from '@/lib/checkout-pending';
import { t } from '@/lib/i18n';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TrialRibbon from '@/components/TrialRibbon';
import { safeSessionStorage } from '@/lib/safe-storage';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
describe('reviewed language and resilient preference storage', () => {
  it('keeps saved Russian while missing strings render English', () => {
    const store = createSafeStorage(() => { throw new Error('Blocked'); });
    expect(store.setItem('medpruef-lang', 'ru')).toBe(false);
    expect(store.getItem('medpruef-lang')).toBe('ru');
    expect(t('request_retry', 'ru')).toBe(t('request_retry', 'en'));
    expect(renderLang('ar')).toBe('en');
    store.removeItem('medpruef-lang'); expect(store.getItem('medpruef-lang')).toBeNull();
  });
  it.each(['en', 'ru', 'ar'])('applies %s as English LTR before hydration', language => {
    const el = { lang: 'de', dir: 'rtl' };
    runInNewContext(LANGUAGE_HEAD_SCRIPT, { document: { documentElement: el }, localStorage: { getItem: () => language } });
    expect(el).toEqual({ lang: 'en', dir: 'ltr' });
  });
  it('detects only reviewed defaults without treating detection as an explicit choice', () => {
    expect(detectLanguage(['de-AT'])).toBe('de');
    expect(detectLanguage(['ar-EG'])).toBe('en');
    expect(detectLanguage(['ru'])).toBe('en');
  });
});
describe('auth hand-offs and internal return targets', () => {
  it.each(['//attacker.test', '/\\attacker.test', '/%5cattacker.test', '/%2fattacker.test', 'https://attacker.test', '/missing', '/login', '/quiz\n'])('rejects %s', next => {
    expect(safeNext(next)).toBe('/');
  });
  it('keeps existing internal query parameters while removing account identity', () => {
    expect(safeNext('/quiz?topic=Herz&limit=10&userId=other#question')).toBe('/quiz?topic=Herz&limit=10#question');
  });
  it('opens register from free/trial intent and never submits checkout on return', () => {
    const entry = parseAuthEntry(new URLSearchParams('intent=trial&exam=pharma&next=%2Fquiz'));
    expect(authDestination(entry)).toBe('/pricing?action=trial&intent=trial&exam=pharma#pro-test');
    expect(initialAuthMode(new URLSearchParams('intent=free'), true)).toBe('register');
    expect(initialAuthMode(new URLSearchParams('reason=expired'), false)).toBe('login');
    expect(initialAuthMode(new URLSearchParams(), false)).toBe('register');
  });
});
describe('auth storage fallback', () => {
  it('retains intent, exam and destination through the cookie when session storage is unavailable', () => {
    vi.stubGlobal('window', { get sessionStorage() { throw new Error('blocked'); } });
    vi.stubGlobal('document', { cookie: '' });
    persistAuthEntry({ intent: 'free', exam: 'pharma', next: '/quiz?topic=Herz&limit=10' });
    safeSessionStorage.removeItem('medpruef_auth_entry');
    expect(readAuthEntry()).toEqual({ intent: 'free', exam: 'pharma', next: '/quiz?topic=Herz&limit=10' });
  });
});
describe('shareable study links', () => {
  it('rejects identity-bearing internal hrefs in the shared link producers', () => {
    for (const path of ['src/app/page.tsx', 'src/components/BottomNav.tsx', 'src/components/Sidebar.tsx', 'src/components/TopicCard.tsx', 'src/components/SearchModal.tsx', 'src/app/study-plan/page.tsx', 'src/app/progress/page.tsx', 'src/app/curriculum/page.tsx']) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/(?:href|Href)[^\n]*[?&]userId=/);
    }
  });
  it('emits allowed parameters and never passes supplied identity', () => {
    const options = { topic: 'Herz & Lunge', examSource: 'pharma', practiceMode: 'wrong', limit: 10, returnTo: '/progress?tab=topics', userId: 'other' };
    const href = buildQuizHref(options);
    expect(href).not.toContain('userId');
    const params = new URL(href, 'https://medpruf.com').searchParams;
    expect(params.get('topic')).toBe('Herz & Lunge');
    expect(params.get('limit')).toBe('10');
    expect(params.get('returnTo')).toBe('/progress?tab=topics');
  });
  it('cleans legacy arrival without losing question, mode, count or return', () => {
    expect(stripLegacyIdentity('/quiz?userId=old&topic=A&practiceMode=wrong&limit=10&returnTo=%2Fhistory'))
      .toBe('/quiz?topic=A&practiceMode=wrong&limit=10&returnTo=%2Fhistory');
  });
});
describe('data-region result contract', () => {
  it('accepts an actual empty successful array', async () => {
    expect(await checkedJson(new Response('[]'), (v): v is unknown[] => Array.isArray(v))).toEqual([]);
  });
  it.each([500, 401, 403])('rejects HTTP %s instead of exposing its error body as data', async status => {
    await expect(checkedJson(new Response('{"error":"provider-secret"}', { status }), isRecord)).rejects.toMatchObject({ status });
  });
  it('rejects malformed successful response shapes', async () => {
    await expect(checkedJson(new Response('{"error":"unexpected"}'), (v): v is unknown[] => Array.isArray(v))).rejects.toMatchObject({ status: 502 });
  });
  it('ignores superseded responses even if transport completes after abort', () => {
    const seq = createRequestSequence(); const old = seq.begin(); const current = seq.begin();
    expect(old.signal.aborted).toBe(true); expect(old.current()).toBe(false); expect(current.current()).toBe(true);
    seq.cancel(); expect(current.current()).toBe(false);
  });
});
describe('provider amounts and truthful payment states', () => {
  it('reserves the enabled desktop ribbon in static server HTML without claiming unknown terms', () => {
    vi.stubGlobal('React', React); // Vitest's JSX transform is classic; Next uses the automatic runtime.
    const html = renderToStaticMarkup(createElement(TrialRibbon, { lang: 'en', initiallyEnabled: true }));
    expect(html).toContain('hidden md:block min-h-16');
    expect(html).toContain('aria-label="Loading"');
    expect(html).not.toContain('19 €');
    expect(renderToStaticMarkup(createElement(TrialRibbon, { lang: 'en', initiallyEnabled: false }))).toBe('');
  });
  it('retains exact historic cents and explicit trial terms', () => {
    expect(billingAmount(1772, 'de')).toBe('17,72 €'); expect(billingAmount(1772, 'en')).toBe('17.72 €');
    expect(billingTrialLine('de', { priceAfterCents: 1772, trialDays: 7, chargeAt: '2026-10-18T00:00:00Z' })).toContain('17,72 €');
    expect(VERIFIED_CANCEL_PATH).toBe(false);
  });
  it('distinguishes pending, unmatched, failed and granted', () => {
    expect(new Set(['pending', 'unmatched', 'failed', 'granted'].map(s => paymentStatusText(s as 'pending', 'en'))).size).toBe(4);
    expect(paymentStatusText('pending', 'de')).toContain('noch nicht aktiv');
  });
  it('blocks a repeat checkout until a later verified grant', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const redirect = { event: 'checkout_redirected', created_at: '2026-10-11T11:55:00Z', tier: 'first_month_19' };
    expect(pendingCheckout([redirect], now)).toEqual(redirect);
    expect(pendingCheckout([{ event: 'grant_succeeded', created_at: '2026-10-11T11:58:00Z' }, redirect], now)).toBeNull();
    expect(pendingCheckout([redirect], now + 30 * 60_000)).toBeNull();
  });
});
