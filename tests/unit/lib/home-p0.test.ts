import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import HomeHero from '@/components/HomeHero';
import TopicCard from '@/components/TopicCard';
import { loadHomeTopics, loadHomeTopicsWithRetry, HomeTopicsFailure, miniAppAuthFailure } from '@/lib/home-topics-request';
import { createRequestSequence } from '@/lib/async-data';
import { canShowHomeTrial, type HomeTrialTerms } from '@/lib/home-trial-announcement';
import { billingTrialLine } from '@/lib/billing-copy';
import { t, type Lang } from '@/lib/i18n';

beforeAll(() => vi.stubGlobal('React', React));
afterEach(() => vi.useRealTimers());
const hero = (values: Partial<React.ComponentProps<typeof HomeHero>> = {}) => renderToStaticMarkup(createElement(HomeHero, {
  greeting: 'Hello', userName: 'Fixture', examLabel: 'Pharmakologie',
  answered: null, total: null, lang: 'en', readiness: { state: 'unavailable' }, phase: 'active',
  primary: { href: '/quiz?examSource=pharma', label: 'Practise new questions' }, secondary: { href: '/study-plan', label: 'Study plan' }, ...values,
}));

describe('HOME-08 known progress, unknown progress and accessible state', () => {
  it.each([{ progressLoading: true }, { progressError: true }])('never exposes zero for unresolved metrics: %j', state => {
    const html = hero(state);
    expect(html).not.toContain('aria-valuenow=');
    expect(html).not.toContain('>0%</');
    expect(html).toContain('height:9px');
    expect(html).toContain('min-height:1.3em');
    expect(html).toContain('aria-valuetext=');
  });
  it('exposes confirmed zero only after both selected-bank results resolve', () => {
    expect(hero({ answered: 0, total: 80 })).toContain('aria-valuenow="0"');
    expect(hero({ answered: 0, total: 80 })).toContain('>0%</bdi>');
  });
  it('replaces unknown progress with the accessible fraction and percentage without changing bar height', () => {
    const html = hero({ answered: 19, total: 20 });
    expect(html).toContain('aria-valuenow="95"');
    expect(html).toContain('<bdi dir="ltr">19</bdi> / <bdi dir="ltr">20</bdi>');
    expect(html).toContain('height:9px');
    expect(html).toContain('min-height:1.3em');
  });
  it('keeps last-good same-bank numbers during retry and exposes a reachable inline retry on failure', () => {
    expect(hero({ answered: 19, total: 20, progressLoading: true })).toContain('>95%</bdi>');
    const html = hero({ answered: 19, total: 20, progressError: true, onProgressRetry: () => {} });
    expect(html).toContain('>95%</bdi>');
    expect(html).toContain('Last loaded progress');
    expect(html).toContain('Try again');
  });
  it.each(['ru', 'uk', 'tr', 'ar'] as Lang[])('preserves %s as a preference while rendering reviewed English and isolated numbers', lang => {
    const html = hero({ answered: 19, total: 20, lang });
    expect(html).toContain('of the question bank seen');
    expect(html).toContain('<bdi dir="ltr">19</bdi>');
    expect(t('home_progress_loading', lang)).toBe('Loading progress');
  });
});

describe('HOME-27 strong topics and zero-answer topics for all three banks', () => {
  for (const examSource of ['kenntnispruefung', 'kmp_innsbruck', 'pharma']) {
    it(`${examSource} renders strong progress independent of weak-topic recommendations`, () => {
      const html = renderToStaticMarkup(createElement(TopicCard, { topic: 'Fixture topic', count: 40, lastCorrectPct: 95, answered: 20, lang: 'en', examSource }));
      expect(html).toContain('95%'); expect(html).toContain('20/40'); expect(html).toContain('width:50%');
      expect(html).toContain(`examSource=${examSource}`); expect(html).not.toContain('userId=');
    });
    it(`${examSource} zero answers gives an empty completion bar, and known zero accuracy is visible after answers`, () => {
      const empty = renderToStaticMarkup(createElement(TopicCard, { topic: 'Fixture topic', count: 40, lastCorrectPct: 0, answered: 0, lang: 'de', examSource }));
      expect(empty).toContain('width:0%'); expect(empty).not.toContain('>0%');
      // a12 (UX-GLOBAL-06): a known zero "last correct" is shown after answers, with its label.
      const wrong = renderToStaticMarkup(createElement(TopicCard, { topic: 'Fixture topic', count: 40, lastCorrectPct: 0, answered: 20, status: 'practice_more', lang: 'en', examSource }));
      expect(wrong).toContain('>0%'); expect(wrong).toContain('last correct'); expect(wrong).toContain('Practise more'); expect(wrong).toContain('20/40');
    });
  }
});

describe('HOME-06/06b bounded topics independent of session state', () => {
  it('at 7999 ms remains pending; at 8000 ms aborts even a transport that ignores abort', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined; let settled = false;
    const fetcher: typeof fetch = async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); };
    const result = loadHomeTopics('pharma', fetcher, new AbortController().signal).catch(error => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(7999); expect(settled).toBe(false); expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
  });
  it.each([503, 500, 401])('rejects %i bodies, and a subsequent healthy retry returns the topics array', async status => {
    await expect(loadHomeTopics('pharma', async () => new Response('{"error":"private"}', { status }), new AbortController().signal)).rejects.toMatchObject({ status });
    expect(await loadHomeTopics('pharma', async () => new Response('[{"topic":"Fixture","count":40}]'), new AbortController().signal)).toEqual([{ topic: 'Fixture', count: 40 }]);
  });
  it.each(['{"error":"not-an-array"}', '[{"topic":"Fixture","count":-1}]', '[{"topic":"Fixture","count":"40"}]'])('rejects malformed successful bodies: %s', async body => {
    await expect(loadHomeTopics('pharma', async () => new Response(body), new AbortController().signal)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects offline transport errors without inventing an empty bank', async () => {
    await expect(loadHomeTopics('pharma', async () => { throw new TypeError('offline'); }, new AbortController().signal)).rejects.toBeInstanceOf(TypeError);
  });
  it('superseded request cannot replace current topics after transport completes late', async () => {
    const seq = createRequestSequence(); const publish = vi.fn(); let resolve!: (r: Response) => void;
    const old = seq.begin(); const done = loadHomeTopics('pharma', () => new Promise<Response>(r => { resolve = r; }), old.signal)
      .then(data => { if (old.current()) publish(data); }).catch(() => {});
    const next = seq.begin();
    const current = await loadHomeTopics('kmp_innsbruck', async () => new Response('[{"topic":"Current","count":20}]'), next.signal);
    if (next.current()) publish(current);
    resolve(new Response('[{"topic":"Old","count":40}]')); await done;
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith([{ topic: 'Current', count: 20 }]);
  });
  it.each([null, 500, 503])('cached Mini App signed session survives auth refresh failure %s', status => {
    expect(miniAppAuthFailure(status, true)).toBe('degraded');
    expect(miniAppAuthFailure(status, false)).toBe('auth');
  });
  it.each([401, 403])('verified auth failure %i recovers sign-in', status => expect(miniAppAuthFailure(status, true)).toBe('auth'));
});

describe('HOME-43 truthful trial copy before cancellation validation', () => {
  it.each(['de', 'en'] as const)('keeps exact cents and only uses a supplied valid charge date (%s)', lang => {
    const line = billingTrialLine(lang, { trialDays: 7, priceAfterCents: 1772, chargeAt: '2026-10-18T10:00:00Z' });
    expect(line).toContain(lang === 'de' ? '17,72 €' : '17.72 €'); expect(line).toContain('2026');
    // [name]'s pick-ux-pub-14 A and SoT section 2: the trial line states the
    // charge condition (cancel before the first charge). It never promises an
    // unverified self-serve path ("jederzeit", "anytime", "mit einem Klick").
    expect(line).toMatch(lang === 'de' ? /wenn Sie nicht vorher kündigen/ : /unless you cancel before/);
    expect(line).not.toMatch(/jederzeit|anytime|any time|mit einem Klick|one click/i);
    expect(billingTrialLine(lang, { trialDays: 7, priceAfterCents: 1772, chargeAt: 'invalid' })).not.toContain('2026');
  });
  it('does not format missing amounts or trial duration into a guessed charge', () => {
    expect(billingTrialLine('en', { trialDays: 7, priceAfterCents: NaN })).toBe('View trial terms.');
    expect(billingTrialLine('de', { trialDays: NaN, priceAfterCents: 1772 })).toBe('Testbedingungen ansehen.');
  });
});

const validTrial: HomeTrialTerms = { eligible: true, trial_enabled: true, is_pro: false, already_trialed: false, trial_days: 7, price_after_cents: 1772, currency: 'EUR' };
describe('HOME-43 announcement queue and feature eligibility', () => {
  const queue = { ready: true, answered: 5, activeSurface: null };
  it('allows only confirmed eligible terms after five answers with no competing announcement', () => {
    expect(canShowHomeTrial(validTrial, queue)).toBe(true);
    expect(canShowHomeTrial(validTrial, { ...queue, answered: 4 })).toBe(false);
    expect(canShowHomeTrial(validTrial, { ...queue, ready: false })).toBe(false);
    expect(canShowHomeTrial(validTrial, { ...queue, activeSurface: 'orientation_modal' })).toBe(false);
  });
  it.each([{ trial_enabled: false }, { eligible: false }, { already_trialed: true }, { is_pro: true }, { price_after_cents: NaN }, { currency: 'USD' }, { trial_days: 0 }])('hides unconfirmed or ineligible trial terms: %j', patch => {
    expect(canShowHomeTrial({ ...validTrial, ...patch }, queue)).toBe(false);
  });
});

describe('a-home-topics-1116 one retry for network and timeout failures', () => {
  const ok = () => new Response('[{"topic":"Fixture","count":40}]');
  it('recovers from one dropped connection and reports two attempts', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { if (++calls === 1) throw new TypeError('Load failed'); return ok(); };
    expect(await loadHomeTopicsWithRetry('pharma', fetcher, new AbortController().signal, 0)).toEqual({ topics: [{ topic: 'Fixture', count: 40 }], attempts: 2 });
  });
  it('succeeds first time with one attempt', async () => {
    expect((await loadHomeTopicsWithRetry('pharma', async () => ok(), new AbortController().signal, 0)).attempts).toBe(1);
  });
  it.each([400, 401, 403, 500, 503])('never retries an HTTP %i answer', async status => {
    const fetcher = vi.fn(async () => new Response('{}', { status }));
    await expect(loadHomeTopicsWithRetry('pharma', fetcher, new AbortController().signal, 0)).rejects.toMatchObject({ attempts: 1, cause: { status } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never retries a malformed body', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":"x"}'));
    await expect(loadHomeTopicsWithRetry('pharma', fetcher, new AbortController().signal, 0)).rejects.toMatchObject({ attempts: 1, cause: { status: 502 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('gives up after the second network failure with attempts 2', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Load failed'); });
    const failure = await loadHomeTopicsWithRetry('pharma', fetcher, new AbortController().signal, 0).catch(error => error);
    expect(failure).toBeInstanceOf(HomeTopicsFailure);
    expect(failure).toMatchObject({ attempts: 2 });
    expect(failure.cause).toBeInstanceOf(TypeError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retries a timeout once, with the backoff between the attempts', async () => {
    vi.useFakeTimers(); let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => { calls++; if (calls === 2) return ok(); return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))); };
    const result = loadHomeTopicsWithRetry('pharma', fetcher, new AbortController().signal, 1200);
    await vi.advanceTimersByTimeAsync(8000); expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1199); expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toMatchObject({ attempts: 2 });
  });
  it('a cancelled request sequence stops the wait and starts no second attempt', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const fetcher = vi.fn(async () => { throw new TypeError('Load failed'); });
    const result = loadHomeTopicsWithRetry('pharma', fetcher, controller.signal, 1200).catch(error => error);
    await vi.advanceTimersByTimeAsync(10); controller.abort();
    expect(await result).toMatchObject({ attempts: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
