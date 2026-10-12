import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENTITLEMENTS, FREE_SAMPLE_DECISION, audienceOf, canUse, featureForPracticeMode, featureFromGate, type Audience, type Feature } from '@/lib/entitlements';
import { gateSentence } from '@/lib/entitlement-copy';
import { isPaidTier } from '@/lib/free-tier';
import { coverage, hitRate, isOpenMistake, lastCorrect, openMistakeIds, topicMetrics, topicStatus, topicStatusText, type Attempt } from '@/lib/learning-metrics';
import { resolveNextStep, weakTopicHref } from '@/lib/next-step';
import { POINTER_QUIET_MS, SURFACES, dismissalUntil, electSurfaces, type QueueContext } from '@/lib/announcements/queue';
import { computeActiveSurface } from '@/lib/announcements/useAnnouncementGate';
import { createSingleFlight, newActionKey } from '@/lib/mutation';
import { FUNNEL_EVENTS, isAllowedEvent, sanitizeEventData, uaClass } from '@/lib/analytics-events';
import { offlineView } from '@/lib/offline-copy';
import { DataResponseError, checkedJson, classifyFailure, resolveRegion, shouldRefetchOnVisible } from '@/lib/async-data';
import { AGAIN_GAP, HARD_GAP, requeueAfterRating, takeDueRequeue, type RequeueItem } from '@/lib/flashcardQueue';
import { getGateCopy, getPaywallCopy } from '@/lib/paywall-copy';
import { signInReasonLine } from '@/lib/auth-entry';
import { buildQuizHref } from '@/lib/quiz-links';

const AUDIENCES: Audience[] = ['guest', 'free', 'trial', 'pro', 'lapsed'];

describe('entitlements matrix (UX-GLOBAL-19, LX-07)', () => {
  it('records the free-sample decision and keeps those features Pro-only for every non-paying audience', () => {
    expect(FREE_SAMPLE_DECISION.pick).toBe('A');
    for (const feature of FREE_SAMPLE_DECISION.proOnly) {
      expect(canUse(feature, 'free'), feature).toBe(false);
      expect(canUse(feature, 'lapsed'), feature).toBe(false);
      expect(canUse(feature, 'guest'), feature).toBe(false);
      expect(canUse(feature, 'pro'), feature).toBe(true);
      expect(canUse(feature, 'trial'), feature).toBe(true);
    }
  });
  it('leaves note review and the free sample open to every signed-in audience', () => {
    for (const a of ['free', 'trial', 'pro', 'lapsed'] as Audience[]) {
      expect(canUse('note_review', a)).toBe(true);
      expect(canUse('question_sample', a)).toBe(true);
      expect(canUse('offline_download', a)).toBe(true);
    }
    expect(canUse('question_sample', 'guest')).toBe(false);
  });
  it('resolves audiences from tier data the same way the server paywall does', () => {
    const past = '2020-01-01T00:00:00Z';
    const future = '2999-01-01T00:00:00Z';
    expect(audienceOf({ signedIn: false })).toBe('guest');
    expect(audienceOf({ signedIn: true, tier: 'free' })).toBe('free');
    expect(audienceOf({ signedIn: true, tier: 'pro', tierExpiresAt: future })).toBe('pro');
    expect(audienceOf({ signedIn: true, tier: 'pro', tierExpiresAt: future, inTrial: true })).toBe('trial');
    expect(audienceOf({ signedIn: true, tier: 'pro', tierExpiresAt: past })).toBe('lapsed');
    expect(audienceOf({ signedIn: true, role: 'admin', tier: 'free' })).toBe('pro');
    for (const [tier, exp] of [['free', null], ['pro', null], ['pro', past], ['pro', future], ['admin', null]] as const) {
      const audience = audienceOf({ signedIn: true, tier, tierExpiresAt: exp });
      expect(canUse('bookmarks', audience), `${tier} ${exp}`).toBe(isPaidTier(tier, exp));
    }
  });
  it('maps practice modes and pricing gates onto features with one gate sentence', () => {
    expect(featureForPracticeMode('review')).toBe('spaced_repetition');
    expect(featureForPracticeMode('wrong')).toBe('mistake_review');
    expect(featureForPracticeMode('unseen')).toBeNull();
    expect(featureFromGate('mistakes')).toBe('mistake_review');
    expect(featureFromGate('mock_exam')).toBe('mock_exam');
    expect(featureFromGate('<script>')).toBeNull();
    for (const feature of Object.keys(ENTITLEMENTS) as Feature[]) {
      expect(gateSentence(feature, 'de')).toMatch(/ ist Teil von Pro\.$/);
      expect(gateSentence(feature, 'en')).toMatch(/ is part of Pro\.$/);
    }
  });
  it('every audience has a cell for every feature', () => {
    for (const cells of Object.values(ENTITLEMENTS)) for (const a of AUDIENCES) expect(typeof cells[a]).toBe('boolean');
  });
});

describe('learning metrics (UX-GLOBAL-06)', () => {
  const day = (d: number, h = 9) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
  const attempts: Attempt[] = [
    { questionId: 1, isCorrect: false, at: day(1) },
    { questionId: 1, isCorrect: true, at: day(2) },
    { questionId: 2, isCorrect: true, at: day(1) },
    { questionId: 2, isCorrect: false, at: day(3) },
    { questionId: 2, isCorrect: false, at: day(3, 10) },
    { questionId: 3, isCorrect: true, at: day(4) },
  ];
  it('counts coverage over distinct questions, latest-correct from the newest attempt, hit rate over all answers', () => {
    expect(coverage(attempts, 10)).toEqual({ seen: 3, total: 10, pct: 30 });
    expect(lastCorrect(attempts)).toEqual({ correct: 2, sample: 3, pct: 67 });
    expect(hitRate(attempts)).toEqual({ correct: 3, answers: 6, pct: 50 });
  });
  it('keeps a question open until two correct answers a day apart after the last miss (PRA-55)', () => {
    expect(isOpenMistake([{ questionId: 1, isCorrect: false, at: day(1) }, { questionId: 1, isCorrect: true, at: day(1, 10) }])).toBe(true);
    expect(isOpenMistake([{ questionId: 1, isCorrect: false, at: day(1) }, { questionId: 1, isCorrect: true, at: day(2) }, { questionId: 1, isCorrect: true, at: day(2, 12) }])).toBe(true);
    expect(isOpenMistake([{ questionId: 1, isCorrect: false, at: day(1) }, { questionId: 1, isCorrect: true, at: day(2) }, { questionId: 1, isCorrect: true, at: day(3, 10) }])).toBe(false);
    expect(isOpenMistake([{ questionId: 1, isCorrect: true, at: day(1) }])).toBe(false);
    expect(openMistakeIds(attempts)).toEqual([1, 2]);
  });
  it('shares one threshold set and never fabricates a percentage below the sample', () => {
    expect(topicStatus(9, 10)).toBe('too_few');
    expect(topicStatus(10, 59)).toBe('practice_more');
    expect(topicStatus(10, 60)).toBeNull();
    expect(topicStatusText('practice_more', 'de')?.definition).toBe('Unter 60 % richtig beantwortet (ab 10 Fragen)');
    const pending = topicMetrics({ topic: 'HNO', total: 100, answered: 12 });
    expect(pending.lastCorrectPct).toBeNull();
    expect(pending.status).toBeNull();
    expect(topicMetrics({ topic: 'HNO', total: 100, answered: 3, lastCorrect: 1, lastSample: 3 }).status).toBe('too_few');
    expect(topicMetrics({ topic: 'HNO', total: 0, answered: 0 }).coveragePct).toBeNull();
  });
});

describe('next-step resolver (UX-GLOBAL-33)', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const base = { exam: 'kenntnispruefung', now, dailyGoal: 20, answeredToday: 5 } as const;
  const weak = [{ topic: 'HNO', answeredDistinct: 30, lastCorrectPct: 40 }, { topic: 'Chirurgie', answeredDistinct: 12, lastCorrectPct: 55 }];
  it('follows the documented order: plan task, last topic under 7 days, weakest topic, new questions', () => {
    expect(resolveNextStep({ ...base, audience: 'pro', planTask: { topic: 'Innere Medizin', count: 8 }, lastSession: { topic: 'HNO', lastActiveAt: '2026-10-11T10:00:00Z' }, topics: weak }).kind).toBe('plan_task');
    expect(resolveNextStep({ ...base, audience: 'pro', lastSession: { topic: 'Neurologie', lastActiveAt: '2026-10-11T10:00:00Z' }, topics: weak }).kind).toBe('last_topic');
    expect(resolveNextStep({ ...base, audience: 'pro', lastSession: { topic: 'Neurologie', lastActiveAt: '2026-09-01T10:00:00Z' }, topics: weak })).toMatchObject({ kind: 'weak_topic', size: 15 });
    expect(resolveNextStep({ ...base, audience: 'pro', topics: [{ topic: 'HNO', answeredDistinct: 5, lastCorrectPct: 10 }] }).kind).toBe('new_questions');
  });
  it('never directs a free learner to a gated target and never invents a due count', () => {
    const free = resolveNextStep({ ...base, audience: 'free', topics: weak, phaseB: true, dueCapped: 12 });
    expect(free.kind).toBe('weak_topic');
    expect(free.href).not.toContain('practiceMode=wrong');
    expect(free.href).not.toContain('practiceMode=review');
    expect(resolveNextStep({ ...base, audience: 'pro', phaseB: true, dueCapped: null }).kind).toBe('new_questions');
    expect(resolveNextStep({ ...base, audience: 'pro', phaseB: true, dueCapped: 0 }).kind).toBe('new_questions');
    expect(resolveNextStep({ ...base, audience: 'pro', phaseB: true, dueCapped: 40 })).toMatchObject({ kind: 'due_review', size: 20 });
  });
  it('shows the done state at the goal and omits minutes without a real median', () => {
    const done = resolveNextStep({ ...base, audience: 'pro', answeredToday: 20 });
    expect(done.kind).toBe('goal_done');
    expect(done.more?.href).toContain('limit=10');
    expect(resolveNextStep({ ...base, audience: 'pro' }).minutes).toBeNull();
    expect(resolveNextStep({ ...base, audience: 'pro', medianAnswerSeconds: 60 }).minutes).toBe(15);
  });
  it('gives Home, the hub and the result card the same destination for the same state', () => {
    const state = { ...base, audience: 'pro' as const, topics: weak };
    expect(resolveNextStep(state).href).toBe(resolveNextStep({ ...state }).href);
    expect(weakTopicHref('HNO', 'pharma', 'pro')).toContain('practiceMode=wrong');
    expect(weakTopicHref('HNO', 'pharma', 'free')).not.toContain('practiceMode');
  });
});

describe('announcement queue (UX-GLOBAL-12)', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  const ctx: QueueContext = { onboardingOpen: false, firstSession: false, answeredTotal: 30, fieldFocused: false, msSincePointerDown: 5_000 };
  it('shows one unrequested inline surface and one modal, by priority', () => {
    expect(electSurfaces(['trial_card', 'install_card', 'referral_floater', 'checkout_stall'], ctx, {}, {}, now)).toEqual({ modal: null, inline: 'checkout_stall' });
    expect(electSurfaces(['trial_card', 'renewal', 'whats_new', 'email_validation'], ctx, {}, {}, now)).toEqual({ modal: 'email_validation', inline: 'renewal' });
  });
  it('keeps the session to its first surface of each kind', () => {
    expect(electSurfaces(['trial_card', 'install_card'], ctx, {}, { inline: 'renewal' }, now).inline).toBeNull();
    expect(electSurfaces(['trial_card'], ctx, {}, { inline: 'trial_card' }, now).inline).toBe('trial_card');
  });
  it('blocks everything over Onboarding and modals in the first session, while typing or right after a tap', () => {
    expect(electSurfaces(['trial_card', 'survey'], { ...ctx, onboardingOpen: true }, {}, {}, now)).toEqual({ modal: null, inline: null });
    expect(electSurfaces(['survey'], { ...ctx, firstSession: true }, {}, {}, now).modal).toBeNull();
    expect(electSurfaces(['survey'], { ...ctx, answeredTotal: 0 }, {}, {}, now).modal).toBeNull();
    expect(electSurfaces(['survey'], { ...ctx, fieldFocused: true }, {}, {}, now).modal).toBeNull();
    expect(electSurfaces(['survey'], { ...ctx, msSincePointerDown: POINTER_QUIET_MS - 1 }, {}, {}, now).modal).toBeNull();
  });
  it('respects dismissal cooldowns after reload and never dismisses forever', () => {
    const later = dismissalUntil('trial_card', 'later', now);
    expect(later - now).toBe(3 * 86_400_000);
    expect(dismissalUntil('trial_card', 'no_interest', now) - now).toBe(14 * 86_400_000);
    expect(electSurfaces(['trial_card', 'install_card'], ctx, { trial_card: later }, {}, now).inline).toBe('install_card');
    expect(electSurfaces(['trial_card'], ctx, { trial_card: later }, {}, later + 1).inline).toBe('trial_card');
    expect(SURFACES.install_card.laterMs).toBe(30 * 86_400_000);
  });
  it('keeps the requested paywall out of the queue', () => {
    expect(Object.keys(SURFACES)).not.toContain('paywall');
  });
  it('waits for session 3 and five answers before the orientation modal (ONB-35)', () => {
    const state = { userId: 'u', sessionCount: 2, qsAnsweredTotal: 9, orientationModalSeenAt: null, cohortBannerDismissedAt: null, referralFloaterDismissedAt: null, lastSessionAt: '' };
    expect(computeActiveSurface(state)).not.toBe('orientation_modal');
    expect(computeActiveSurface({ ...state, sessionCount: 3 })).toBe('orientation_modal');
    expect(computeActiveSurface({ ...state, sessionCount: 3, qsAnsweredTotal: 4 })).toBeNull();
  });
});

describe('mutations (UX-GLOBAL-18)', () => {
  it('a double activation produces one effective write and one action key', async () => {
    const keys: string[] = [];
    let release!: () => void;
    const flight = createSingleFlight();
    const task = (key: string) => { keys.push(key); return new Promise<string>(resolve => { release = () => resolve('ok'); }); };
    const first = flight.run(task);
    const second = await flight.run(task);
    expect(second).toBeUndefined();
    expect(flight.busy()).toBe(true);
    release();
    await first;
    expect(keys).toHaveLength(1);
    expect(flight.busy()).toBe(false);
  });
  it('a retry after failure reuses the key; a success rotates it', async () => {
    const keys: string[] = [];
    const flight = createSingleFlight();
    await flight.run(async key => { keys.push(key); throw new Error('net'); }).catch(() => undefined);
    await flight.run(async key => { keys.push(key); return 1; });
    await flight.run(async key => { keys.push(key); return 1; });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
  it('a bfcache reset ignores the late settle', async () => {
    let release!: () => void;
    const flight = createSingleFlight();
    const pending = flight.run(() => new Promise<void>(resolve => { release = resolve; }));
    flight.reset();
    expect(flight.busy()).toBe(false);
    release();
    await pending;
    expect(flight.busy()).toBe(false);
  });
  it('action keys are RFC 4122 UUIDs (the answer route validates them)', () => {
    expect(newActionKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
  it('the pending Button never sets the disabled attribute on the pressed control', () => {
    const src = readFileSync('src/components/ui/Button.tsx', 'utf8');
    expect(src).toContain('disabled={disabled}');
    expect(src).not.toContain('disabled={disabled || loading}');
    expect(src).toMatch(/if \(loading\) \{ event\.preventDefault\(\); return \}/);
  });
});

describe('measurement contract (UX-GLOBAL-32)', () => {
  it('rejects identity, tokens and free text and keeps declared attribution', () => {
    const out = sanitizeEventData('paywall_hit', {
      gate: 'qbank_limit', exam: 'pharma', surface: 'quiz', trigger: 'quota',
      email: 'user-65abd062@example.com', name: 'Anna', userId: 'u-1', token: 'eyJhbGciOi.eyJzdWIiOi.sig', extra: 'x',
    });
    expect(out).toEqual({ gate: 'qbank_limit', exam: 'pharma', surface: 'quiz', trigger: 'quota' });
    const legacy = sanitizeEventData('page_view', { page: '/quiz?userId=abc&topic=x', note: 'free text here', q: 'search', topic: 'Innere Medizin / Kardiologie' });
    expect(legacy).toEqual({ page: '/quiz', topic: 'Innere Medizin / Kardiologie' });
    expect(sanitizeEventData('cta_click', { surface: 'home', slot: 'hero', intent: 'free', href: '/x?userId=1' })).toEqual({ surface: 'home', slot: 'hero', intent: 'free' });
    expect(sanitizeEventData('error_state_shown', { page: 'Ein sehr langer Satz mit vielen Wörtern der niemals ein Attribut sein sollte' })).toEqual({});
    expect(sanitizeEventData('cta_click', { surface: 'contact anna@example.com' })).toEqual({});
  });
  it('drops unknown names and marks automation', () => {
    expect(isAllowedEvent('paywall_hit')).toBe(true);
    expect(isAllowedEvent('question_answer')).toBe(true);
    expect(isAllowedEvent('paywall_view')).toBe(false);
    expect(isAllowedEvent('language_switch')).toBe(false);
    expect(FUNNEL_EVENTS.every(isAllowedEvent)).toBe(true);
    expect(uaClass('Mozilla/5.0 (X11; Linux) HeadlessChrome/120')).toBe('automation');
    expect(uaClass('Mozilla/5.0 (iPhone) Safari/605')).toBe('browser');
  });
  it('the server writes paywall_hit, the name the admin tile and digest read', () => {
    expect(readFileSync('src/lib/free-access.ts', 'utf8')).toContain('event_type: "paywall_hit"');
    expect(readFileSync('src/app/api/admin/overview/route.ts', 'utf8')).toContain('"paywall_hit"');
  });
});

describe('offline status (UX-GLOBAL-20)', () => {
  const base = { online: false, persisted: true, queued: 0, stored: 0, justReconnected: false, lang: 'de' };
  it('a blip under three seconds shows nothing', () => {
    expect(offlineView({ ...base, persisted: false }).state).toBe('hidden');
  });
  it('claims only what the device really holds', () => {
    const queued = offlineView({ ...base, queued: 3 });
    expect(queued).toMatchObject({ state: 'offline', tone: 'info', detail: '3 warten' });
    expect(queued.state !== 'hidden' && queued.text).toContain('später gesendet');
    expect(offlineView({ ...base, stored: 250 })).toMatchObject({ tone: 'info', text: 'Offline: 250 Fragen bereit.' });
    const empty = offlineView(base);
    expect(empty).toMatchObject({ tone: 'warning', text: 'Offline: keine Fragen geladen.' });
    expect(empty.state === 'offline' && empty.action?.href).toBe('/settings#offline');
  });
  it('says everything was sent only when the outbox is empty', () => {
    expect(offlineView({ ...base, online: true, justReconnected: true, queued: 0 }).state).toBe('reconnected');
    expect(offlineView({ ...base, online: true, justReconnected: true, queued: 2 }).state).toBe('hidden');
    expect(offlineView({ ...base, online: true, justReconnected: true, queued: null }).state).toBe('hidden');
  });
});

describe('async data contract (UX-GLOBAL-16)', () => {
  it('distinguishes slow, timeout, 500, malformed, 200-empty and 200-data', async () => {
    const malformed = await checkedJson(new Response('{"x":1}', { status: 200 }), (v): v is unknown[] => Array.isArray(v)).catch(e => e);
    const views = [
      resolveRegion({ settled: false, elapsedMs: 9_000 }),
      resolveRegion({ settled: true, elapsedMs: 8_000, error: new DOMException('Request timed out', 'TimeoutError') }),
      resolveRegion({ settled: true, elapsedMs: 100, error: new DataResponseError(500) }),
      resolveRegion({ settled: true, elapsedMs: 100, error: malformed }),
      resolveRegion({ settled: true, elapsedMs: 100, data: [] }),
      resolveRegion({ settled: true, elapsedMs: 100, data: [1] }),
    ];
    expect(new Set(views.map(v => `${v.state}:${v.reason}`)).size).toBe(6);
    expect(views.filter(v => v.state === 'empty')).toHaveLength(1);
    expect(views[4].state).toBe('empty');
  });
  it('keeps 401, 403 and offline in their own classes', () => {
    expect(classifyFailure(new DataResponseError(401))).toBe('expired');
    expect(classifyFailure(new DataResponseError(403))).toBe('forbidden');
    expect(classifyFailure(new TypeError('Failed to fetch'), false)).toBe('offline');
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('network');
    expect(shouldRefetchOnVisible(null, 0)).toBe(true);
    expect(shouldRefetchOnVisible(0, 59_000)).toBe(false);
    expect(shouldRefetchOnVisible(0, 60_000)).toBe(true);
  });
});

describe('review re-queue (UX-GLOBAL-34)', () => {
  const card = (id: number) => ({ id });
  it('"Nochmal" returns within 3 to 5 cards, "Schwer" once later, ratings above drop the card', () => {
    const hard = new Set<number>();
    let queue: RequeueItem<{ id: number }>[] = [];
    queue = requeueAfterRating(queue, card(1), 'again', 1, hard);
    expect(AGAIN_GAP).toBeGreaterThanOrEqual(3);
    expect(AGAIN_GAP).toBeLessThanOrEqual(5);
    expect(takeDueRequeue(queue, 1 + AGAIN_GAP - 1).card).toBeNull();
    expect(takeDueRequeue(queue, 1 + AGAIN_GAP).card).toEqual(card(1));
    queue = requeueAfterRating(queue, card(2), 'hard', 2, hard);
    queue = requeueAfterRating(queue, card(2), 'hard', 12, hard);
    expect(queue.filter(item => item.card.id === 2)).toHaveLength(0);
    queue = requeueAfterRating([], card(3), 'hard', 0, new Set());
    expect(queue[0].at).toBe(HARD_GAP);
    expect(requeueAfterRating(queue, card(3), 'good', 1, new Set())).toHaveLength(0);
  });
  it('the flashcard tray no longer carries invented intervals', () => {
    const src = readFileSync('src/app/flashcards/page.tsx', 'utf8');
    expect(src).not.toContain('INTERVAL_HINT');
    expect(src).toContain('intervalLabel(');
    expect(readFileSync('src/app/api/answer/route.ts', 'utf8')).toContain('review,');
  });
});

describe('paywall and money copy (UX-GLOBAL-08/19)', () => {
  it('builds the paywall title from the server cap and bank', () => {
    const copy = getGateCopy({ lang: 'de', gate: 'qbank_limit', limit: 150, bankLabel: 'Pharmakologie / Rezeptierkunde', accuracyPct: 71 });
    expect(copy.title).toBe('Sie haben alle 150 kostenlosen Fragen in Pharmakologie / Rezeptierkunde beantwortet.');
    expect(copy.result).toBe('Ihr Ergebnis bisher: 71 % richtig.');
    expect(copy.pricingHref).toBe('/pricing?gate=qbank_limit');
    expect(getGateCopy({ lang: 'de', gate: 'wrong_only' }).title).toBe('Das Wiederholen Ihrer Fehler ist Teil von Pro.');
    expect(getGateCopy({ lang: 'en', gate: 'wrong_only' }).pricingHref).toBe('/pricing?gate=mistakes');
  });
  it('makes no pass promise and defines no second guarantee', () => {
    for (const lang of ['de', 'en'] as const) {
      const text = JSON.stringify(getPaywallCopy({ lang }));
      expect(text).not.toMatch(/first try|ersten Versuch|Geld-zurück|money-back/i);
    }
  });
  it('money surfaces carry no literal plan amount and no unqualified cancel-anytime promise', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { if (!/^(admin|blog|api)$/.test(name)) walk(full); }
        else if (/\.tsx$/.test(name)) files.push(full);
      }
    };
    walk('src/app'); walk('src/components');
    const literalPlan = /(?<![\d.,])(?:19|49|129)(?:[.,]00)? ?€|€ ?(?:19|49|129)(?![\d.,])/;
    const cancelAnytime = /cancel anytime|jederzeit kündbar|jederzeit kündigen/i;
    for (const file of files) {
      // Comments document plans; only rendered source counts.
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
      const lines = code.split('\n');
      for (const line of lines) {
        expect(literalPlan.test(line), `${file}: ${line.trim().slice(0, 120)}`).toBe(false);
        expect(cancelAnytime.test(line), `${file}: ${line.trim().slice(0, 120)}`).toBe(false);
      }
    }
  });
});

describe('auth hand-offs and identity (UX-GLOBAL-17/31/38)', () => {
  it('names the destination on a signed-out redirect and ignores unsafe targets', () => {
    expect(signInReasonLine('/mistakes?examSource=pharma', 'de')).toBe('Bitte melden Sie sich an, um Ihre Fehlerliste zu sehen.');
    expect(signInReasonLine('//evil.example/mistakes', 'de')).toBeNull();
    expect(signInReasonLine('/quiz', 'de')).toBeNull();
  });
  it('study links never carry a learner id', () => {
    expect(weakTopicHref('HNO', 'kenntnispruefung', 'pro')).not.toMatch(/userId=/);
    expect(buildQuizHref({ topic: 'HNO', returnTo: '/progress?userId=1' })).not.toMatch(/userId/);
  });
  it('no internal href in the touched study files carries userId=', () => {
    for (const file of ['src/app/page.tsx', 'src/app/progress/page.tsx', 'src/app/flashcards/page.tsx', 'src/components/TopicCard.tsx', 'src/components/BottomNav.tsx', 'src/components/Sidebar.tsx', 'src/lib/next-step.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/[?&]userId=/);
    }
  });
});
