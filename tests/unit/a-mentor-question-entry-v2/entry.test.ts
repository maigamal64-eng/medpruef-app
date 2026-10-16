import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => { (globalThis as Record<string, unknown>).React = await import('react'); });

// Capture the props MentorQuestionEntry hands to the link (the real link renders only after mount).
vi.mock('@/components/mentor/entries/MentorEntryLink', () => ({
  MentorEntryLink: (props: Record<string, unknown>) => React.createElement('i', { 'data-props': JSON.stringify(props) }),
}));
vi.mock('@/lib/hooks/useUserTier', () => ({ useUserTier: () => ({ referralSurface: false }) }));
vi.mock('@/lib/hooks/useReferralInvite', () => ({ useReferralInvite: () => null }));
vi.mock('@/components/referrals/ReferralShareActions', () => ({ default: () => null }));
vi.mock('@/lib/tracker', () => ({ trackEvent: vi.fn() }));

import { mentorQuestionEntryV2 } from '@/lib/mentor/question-entry-flag';
import { MentorQuestionEntry, questionEntryShape, type MentorQuestionEntryProps } from '@/components/mentor/entries/MentorQuestionEntry';
import { entryT } from '@/components/mentor/entries/entry-copy';
import { a39T } from '@/components/mentor/a39-copy';
import { mentorEntryHref } from '@/components/mentor/entries/href';
import { parseMentorEntry } from '@/components/mentor/entry';
import FirstRunCard from '@/components/mentor/FirstRunCard';
import type { MentorPackageOffer } from '@/lib/mentor/contract';

beforeAll(() => vi.stubGlobal('React', React));

type Placement = MentorQuestionEntryProps['placement'];
const PLACEMENTS: Placement[] = ['answer', 'erklaerung', 'explanation'];
const props = (html: string) => [...html.matchAll(/data-props="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
const render = (p: Partial<MentorQuestionEntryProps>, v2: boolean) =>
  props(renderToStaticMarkup(createElement(MentorQuestionEntry, { questionId: 42, wasCorrect: false, answered: true, placement: 'answer', lang: 'de', v2, ...p } as MentorQuestionEntryProps)));

describe('flag parser', () => {
  it('only the literal "true" turns it on', () => {
    expect(mentorQuestionEntryV2('true')).toBe(true);
    for (const v of [undefined, '', 'TRUE', '1', 'yes', ' true', 'false']) expect(mentorQuestionEntryV2(v)).toBe(false);
  });
  it('defaults to the inlined env name (off in tests)', () => {
    expect(readFileSync('src/lib/mentor/question-entry-flag.ts', 'utf8')).toMatch(/process\.env\.NEXT_PUBLIC_MENTOR_QUESTION_ENTRY_V2/);
    expect(mentorQuestionEntryV2()).toBe(false);
  });
});

describe('v2 placement: exactly one card entry per outcome (strip or Erklärung pane)', () => {
  const cardEntries = (wasCorrect: boolean | null, explanationPane: boolean) =>
    (['answer', 'erklaerung'] as const).filter((placement) => questionEntryShape({ wasCorrect, placement, explanationPane, lang: 'de' }, true));
  it('wrong or partial: under the strip, prominent, wrong draft', () => {
    expect(cardEntries(false, true)).toEqual(['answer']);
    expect(cardEntries(false, false)).toEqual(['answer']);
    const s = questionEntryShape({ wasCorrect: false, placement: 'answer', lang: 'de' }, true)!;
    expect(s).toEqual({ label: 'Warum ist meine Antwort falsch? Mentor fragen', draft: 'Warum ist meine Antwort falsch?', tone: 'prominent' });
  });
  it('correct and open answers: end of the Erklärung pane, quiet, steps draft', () => {
    for (const w of [true, null]) {
      expect(cardEntries(w, true)).toEqual(['erklaerung']);
      expect(questionEntryShape({ wasCorrect: w, placement: 'erklaerung', lang: 'en' }, true)).toEqual({ label: 'Still unclear? Have the mentor explain it step by step', draft: 'Explain step by step', tone: 'quiet' });
    }
  });
  it('no Erklärung pane (hideExplanation): the strip carries the correct-answer entry', () => {
    for (const w of [true, null]) expect(cardEntries(w, false)).toEqual(['answer']);
  });
  it('drops the counts_one note on the card entry under v2; the KI pane entry stays as is', () => {
    for (const w of [true, false, null]) for (const placement of ['answer', 'erklaerung'] as const) {
      const s = questionEntryShape({ wasCorrect: w, placement, lang: 'de' }, true);
      if (s) expect(s.note).toBeUndefined();
    }
    expect(questionEntryShape({ wasCorrect: true, placement: 'explanation', lang: 'de' }, true)).toEqual({ label: entryT('question_cta', 'de'), note: entryT('counts_one', 'de'), tone: 'quiet' });
  });
  it('non-German UI languages read English; drafts follow the label language', () => {
    const s = questionEntryShape({ wasCorrect: false, placement: 'answer', lang: 'ru' }, true)!;
    expect(s.label).toBe(entryT('question_cta_wrong', 'en'));
    expect(s.draft).toBe(a39T('starter_wrong', 'en'));
  });
  it('no price, package name or dash in the card copy', () => {
    for (const l of ['de', 'en']) for (const k of ['question_cta_wrong', 'question_cta_right'] as const) {
      expect(entryT(k, l)).not.toMatch(/[€—–]|\d|Basis|Plus|Paket|package/i);
    }
    for (const l of ['de', 'en'] as const) expect(a39T('first_run_prepared', l)).not.toMatch(/[€—–]|\d/);
  });
});

describe('flag off: today\'s two entries unchanged', () => {
  it('answer + KI pane entries keep label, note and tone; no Erklärung pane entry', () => {
    expect(render({ placement: 'erklaerung' }, false)).toEqual([]);
    const [a] = render({ placement: 'answer', wasCorrect: false }, false);
    expect(a).toMatchObject({ surface: 'question', from: 'question', label: 'Mit dem Mentor besprechen', note: 'zählt als eine Nachricht', tone: 'prominent' });
    expect(a.draft).toBeUndefined();
    const [k] = render({ placement: 'explanation', wasCorrect: false }, false);
    expect(k).toMatchObject({ surface: 'explanation', from: 'explanation', note: 'zählt als eine Nachricht', tone: 'quiet' });
    const [c] = render({ placement: 'answer', wasCorrect: true }, false);
    expect(c).toMatchObject({ tone: 'quiet', label: 'Mit dem Mentor besprechen' });
  });
  it('never in exam simulation, flag on or off', () => {
    for (const v2 of [true, false]) for (const placement of PLACEMENTS) expect(render({ placement, examMode: true }, v2)).toEqual([]);
  });
});

describe('href and impression dedup', () => {
  it('v2 href carries q = the starter string and from=question|explanation', () => {
    const [a] = render({ placement: 'answer', wasCorrect: false }, true);
    const href = mentorEntryHref(a);
    expect(parseMentorEntry(new URL(href, 'https://x').search)).toMatchObject({ mode: 'explain', entry: 'question', questionId: 42, draft: 'Warum ist meine Antwort falsch?' });
    const [e] = render({ placement: 'erklaerung', wasCorrect: true }, true);
    expect(parseMentorEntry(new URL(mentorEntryHref(e), 'https://x').search)).toMatchObject({ entry: 'explanation', draft: 'Erklären Sie Schritt für Schritt' });
  });
  it('dedup key is per question and pane, flag on and off; surface stays per placement', () => {
    for (const v2 of [true, false]) {
      const [a] = render({ placement: 'answer', questionId: 1 }, v2);
      const [b] = render({ placement: 'answer', questionId: 2 }, v2);
      expect(a.dedupKey).toBe('answer:1');
      expect(b.dedupKey).toBe('answer:2');
      expect(a.surface).toBe('question');
    }
    const [e] = render({ placement: 'erklaerung', wasCorrect: true, questionId: 3 }, true);
    const [k] = render({ placement: 'explanation', wasCorrect: true, questionId: 3 }, true);
    expect(e.dedupKey).toBe('erklaerung:3');
    expect(k.dedupKey).toBe('explanation:3');
  });
  it('MentorEntryLink dedups on dedupKey and sends entry and mode only', () => {
    const src = readFileSync('src/components/mentor/entries/MentorEntryLink.tsx', 'utf8');
    expect(src).toMatch(/const impressionKey = dedupKey \?\? surface;/);
    expect(src).toMatch(/trackMentorOnce\(userId\(\), "mentor_entry_shown", impressionKey, \{ entry: input\.from, mode: input\.mode \}\)/);
  });
  it('nav mentor items emit a click event with entry nav', () => {
    expect(readFileSync('src/components/mentor/telemetry.ts', 'utf8')).toMatch(/trackMentor\("mentor_entry_click", \{ entry: "nav" \}\)/);
    for (const f of ['src/components/Sidebar.tsx', 'src/components/BottomNav.tsx', 'src/components/nav/MoreSheet.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/key === "mentor" \? trackMentorNavClick : undefined/);
    }
  });
});

describe('first run with 0 credits from a question', () => {
  const offers = [{ id: 'mentor_basis', kind: 'subscription', period_days: 30, price_eur_cents: 900, credits: 100 }] as unknown as MentorPackageOffer[];
  const now = new Date('2026-10-20T10:00:00Z');
  it('prepared: the prepared line above the price, packages kept, no sample toggle', () => {
    const html = renderToStaticMarkup(createElement(FirstRunCard, { offers, lang: 'de', now, prepared: true }));
    const iPrep = html.indexOf('Ihre Nachricht an den Mentor ist vorbereitet.');
    expect(iPrep).toBeGreaterThan(-1);
    expect(iPrep).toBeLessThan(html.indexOf('Der Mentor läuft mit Credits.'));
    expect(html).toContain('Pakete ansehen');
    expect(html).not.toContain('Beispielantwort ansehen');
  });
  it('not prepared: byte-identical to the card without the prop', () => {
    const a = renderToStaticMarkup(createElement(FirstRunCard, { offers, lang: 'en', now }));
    const b = renderToStaticMarkup(createElement(FirstRunCard, { offers, lang: 'en', now, prepared: false }));
    expect(b).toBe(a);
    expect(a).not.toContain('is ready');
  });
  it('the chat screen passes prepared only with v2, first run, explain mode and a question', () => {
    const src = readFileSync('src/components/mentor/MentorChatScreen.tsx', 'utf8');
    expect(src).toMatch(/const preparedFirstRun = questionEntryV2 && firstRun && mode === "explain" && questionId !== undefined;/);
    expect(src).toMatch(/onClickCapture=\{questionEntryV2 \? rememberReturn : undefined\}/);
    // Only the entry's own draft is kept, never typed text (analytics would see ?q=).
    expect(src).toMatch(/selectedOptionText: ctx\.selectedOptionText, draft: ctx\.draft \}/);
  });
});
