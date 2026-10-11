import { describe, expect, it, vi } from 'vitest';
import { parseChatRequest } from '@/lib/mentor/guard';
import { readMentorConfig } from '@/lib/mentor/config';
import { makeTurnRow } from '@/lib/mentor/outcomes';
import { createMentorRequestStore } from '@/lib/mentor/requests';
import { deadlineTemplate } from '@/lib/mentor/deadline-copy';
import { refusalLine, R4_RULING_REFUSALS, isFallbackOnlyText } from '@/lib/mentor/prompt/refusals';
import { createRunMentorTurn } from '@/lib/mentor/turn';
import { collect, makeDeps, turnInput } from './helpers';
import { topicNotice, notConfirmedForFactId } from '@/lib/mentor/trust-copy';
import { registrationStatus } from '@/lib/mentor/tools/run';
import { OFFICIAL_SITTINGS } from '@/lib/exam-dates';
import { handleMentorChat } from '@/app/api/mentor/chat/handler';
import { chatSetup, post } from './handlers.test';
import { USER } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MentorFact } from '@/lib/mentor/seam';
const GOOD = { client_request_id: '44444444-4444-4444-8444-444444444444', message: 'What is the deadline?', lang: 'en', mode: 'facts' };

describe('R4 request attribution, transport reservation and access', () => {
  it('MUX-96/112 defaults to nav/web and rejects arbitrary attribution', () => {
    expect(parseChatRequest(GOOD)).toMatchObject({ ok: true, request: { entry: 'nav', channel: 'web' } });
    for (const field of ['entry', 'channel']) for (const value of ['anything', null, 2]) expect(parseChatRequest({ ...GOOD, [field]: value }).ok).toBe(false);
    const parsed = parseChatRequest({ ...GOOD, entry: 'exam_dates', channel: 'telegram' });
    if (!parsed.ok) throw new Error('parse failed');
    expect(makeTurnRow({ requestId: GOOD.client_request_id, userId: USER, request: parsed.request, startedAt: new Date(), final: null, latencyMs: 0, calls: 0, chargedMicro: 0, houseMicro: 0, retries: 0, coldCache: false })).toMatchObject({ entry: 'exam_dates', channel: 'telegram' });
  });
  it('MUX-96/112 fingerprints attribution with stable legacy defaults', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true, claimed: true, request_id: GOOD.client_request_id }, error: null }));
    const store = createMentorRequestStore({ rpc } as unknown as SupabaseClient);
    const parsed = parseChatRequest(GOOD); if (!parsed.ok) throw new Error('parse failed');
    await store.claim(USER, parsed.request, GOOD.client_request_id);
    await store.claim(USER, { ...parsed.request, entry: 'home' }, GOOD.client_request_id);
    const first = rpc.mock.calls[0] as unknown as [string, { p_meta: object; p_fingerprint: string }];
    const second = rpc.mock.calls[1] as unknown as [string, { p_fingerprint: string }];
    expect(first[1].p_meta).toMatchObject({ entry: 'nav', channel: 'web' });
    expect(first[1].p_fingerprint).not.toBe(second[1].p_fingerprint);
  });
  it('MUX-112 Telegram flag defaults off and web route cannot imitate its adapter', async () => {
    expect(readMentorConfig({}).telegramEnabled).toBe(false);
    expect(readMentorConfig({ MENTOR_TELEGRAM_ENABLED: 'true' }).telegramEnabled).toBe(true);
    const s = chatSetup([], { config: { ...readMentorConfig({}), aiFeaturesEnabled: true, enabled: true, telegramEnabled: true } });
    const claim = vi.spyOn(s.deps.requests, 'claim');
    const result = await handleMentorChat(post({ ...GOOD, channel: 'telegram' }), s.deps);
    expect(result.status).toBe(400); expect(claim).not.toHaveBeenCalled();
  });

});

describe('R4 grounded deadline and missing topic formatting', () => {
  it('MUX-05 every active language leads with closing date and exact tool-owned days', () => {
    const sitting = OFFICIAL_SITTINGS.find(s => s.exam_key === 'sip4a' && s.date === '2026-11-18');
    if (!sitting) throw new Error('sitting absent');
    const status = registrationStatus(sitting, new Date('2026-10-12T10:00:00+02:00'));
    expect(status.daysUntilClose).toBe(7);
    for (const lang of ['de', 'en', 'ru', 'uk', 'tr', 'fr', 'ar'] as const) {
      const result = deadlineTemplate(sitting, lang, status);
      expect(result?.closing_line).toContain('19'); expect(result?.closing_line).toContain('2026'); expect(result?.closing_line).toContain('7');
      expect(result?.closing_line.startsWith('**')).toBe(true);
      expect(result?.closing_line).not.toContain('late'); expect(result?.closing_line).not.toContain('Nachmeldung');
    }
    expect(deadlineTemplate(sitting, 'ar', status)).toEqual(deadlineTemplate(sitting, 'en', status));
    expect(deadlineTemplate(sitting, 'en', { status: 'not_confirmed', daysUntilClose: null })).toBeNull();
  });
  it('MUX-07 missing pass rules use the resolved fact topic in each active language', () => {
    const fact = { id: 'sip4a.pass_rule', topic: 'pass_rule', exam_key: 'sip4a' } as MentorFact;
    const expected = { de: 'Bestehensregel', en: 'pass rule', ru: 'проходной балл', uk: 'прохідний бал', tr: 'geçme kuralını', fr: 'règle de réussite', ar: 'pass rule' };
    for (const lang of ['de', 'en', 'ru', 'uk', 'tr', 'fr', 'ar'] as const) expect(notConfirmedForFactId(lang, fact.id, id => id === fact.id ? fact : null)).toContain(expected[lang]);
  });
});


describe('localized fallback-only billing remains on the house', () => {
  it('recognizes legacy German and every topic/language notice, with no learner debit', async () => {
    const legacy = 'Diese Angabe ist nicht offiziell bestätigt. Bitte prüf sie auf der offiziellen Seite: https://example.org/official';
    expect(isFallbackOnlyText(legacy)).toBe(true);
    for (const lang of ['de', 'en', 'ru', 'uk', 'tr', 'fr', 'ar'] as const) {
      for (const topic of ['registration', 'dates', 'fee', 'pass_rule', 'procedure'] as const) {
        const fact = { id: 'sip4a.' + topic, exam_key: 'sip4a', topic } as MentorFact;
        const text = topicNotice(lang, fact);
        expect(isFallbackOnlyText(text)).toBe(true);
        expect(isFallbackOnlyText(topicNotice(lang) + '\n' + text)).toBe(true);
        expect(isFallbackOnlyText('A confirmed answer. ' + text)).toBe(false);
        const env = makeDeps([{ text: 'unsupported' }], { grantMicro: 200000 });
        env.deps.brain.validate = () => ({ blocks: [{ text, fact_ids: [] }], citations: [], replaced: true, rejected: [] });
        const input = turnInput(); input.request.lang = lang;
        const events = await collect(createRunMentorTurn()(env.deps, input));
        expect(events.find(event => event.type === 'final')).toMatchObject({ result: 'notice', charged: false, credits_used: 0 });
        expect(env.ledger.entries.some(entry => entry.kind === 'settle')).toBe(false);
        expect(env.ledger.entries.some(entry => entry.kind === 'house_cost')).toBe(true);
      }
    }
  });
});

it('R4 native-pending ruling refusals preserve localization and Arabic fallback', () => {
  for (const lang of ['ru', 'uk', 'tr'] as const) {
    expect(refusalLine('individual_ruling', lang)).toBe(R4_RULING_REFUSALS[lang].text);
    expect(R4_RULING_REFUSALS[lang].reviewer).toBeNull();
  }
  expect(refusalLine('individual_ruling', 'ar')).toBe(refusalLine('individual_ruling', 'en'));
  for (const lang of ['ru', 'uk', 'tr', 'ar'] as const) expect(refusalLine('patient_advice', lang)).toBe(refusalLine('patient_advice', 'en'));
});
