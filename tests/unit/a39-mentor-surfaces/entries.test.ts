import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/mentor/useMentorAvailability', () => ({ useMentorAvailability: () => 'available' }));
vi.mock('@/components/mentor/telemetry', () => ({ trackMentor: vi.fn(), trackMentorOnce: vi.fn() }));

import { parseMentorEntry } from '@/components/mentor/entry';
import { mentorEntryHref } from '@/components/mentor/entries/href';
import { entryT } from '@/components/mentor/entries/entry-copy';
import { MentorQuestionEntry } from '@/components/mentor/entries/MentorQuestionEntry';
import { MentorEntryLink } from '@/components/mentor/entries/MentorEntryLink';
import { feedbackSource, isMentorFeedback } from '@/components/mentor/entries/feedback-source';
import { mentorPackageName } from '@/components/mentor/entries/settings-format';

beforeAll(() => vi.stubGlobal('React', React));
const search = (href: string) => new URL(href, 'https://medpruf.com').search;

describe('mentorEntryHref round-trips through parseMentorEntry', () => {
  it('explain from a question keeps id, answered and the chosen option text', () => {
    const href = mentorEntryHref({ mode: 'explain', from: 'question', questionId: 4711, answered: true, selectedOptionText: 'Furosemid & ACE-Hemmer' });
    expect(href.startsWith('/mentor?')).toBe(true);
    expect(parseMentorEntry(search(href))).toEqual({ mode: 'explain', entry: 'question', questionId: 4711, answered: true, selectedOptionText: 'Furosemid & ACE-Hemmer', draft: '' });
  });
  it('explanation entry and unanswered flag', () => {
    const href = mentorEntryHref({ mode: 'explain', from: 'explanation', questionId: 9, answered: false });
    expect(parseMentorEntry(search(href))).toEqual({ mode: 'explain', entry: 'explanation', questionId: 9, answered: false, draft: '' });
  });
  it('study and facts drafts survive, never auto-sent fields', () => {
    const draft = entryT('home_plan_draft', 'de', { topic: 'Innere Medizin' });
    expect(parseMentorEntry(search(mentorEntryHref({ mode: 'study', from: 'home', draft })))).toEqual({ mode: 'study', entry: 'home', answered: true, draft });
    const f = mentorEntryHref({ mode: 'facts', from: 'exam_dates', draft: entryT('sitting_draft', 'en', { sitting: 'SIP4a / SIP5a MedUni Wien' }) });
    expect(parseMentorEntry(search(f))).toMatchObject({ mode: 'facts', entry: 'exam_dates', draft: 'Please explain the date and registration for SIP4a / SIP5a MedUni Wien.' });
  });
  it('caps the draft at 200 and drops an over-long option instead of cutting it', () => {
    const href = mentorEntryHref({ mode: 'explain', from: 'question', questionId: 1, answered: true, selectedOptionText: 'x'.repeat(301), draft: 'ä'.repeat(250) });
    const parsed = parseMentorEntry(search(href));
    expect(parsed.selectedOptionText).toBeUndefined();
    expect([...parsed.draft]).toHaveLength(200);
  });
  it('explain without a question becomes facts, as the parser does', () => {
    const href = mentorEntryHref({ mode: 'explain', from: 'question' });
    expect(parseMentorEntry(search(href))).toMatchObject({ mode: 'facts', entry: 'question' });
  });
  it('copy falls back to English for every non-German language and has no em dash', () => {
    expect(entryT('question_cta', 'de')).toBe('Mit dem Mentor besprechen');
    expect(entryT('question_cta', 'ar')).toBe('Discuss with the mentor');
    expect(entryT('counts_one', 'de')).toBe('zählt als eine Nachricht');
    for (const l of ['de', 'en']) for (const k of ['question_cta', 'home_plan', 'deadline', 'mistakes', 'sitting', 'settings_delete_body'] as const) expect(entryT(k, l)).not.toContain('—');
  });
});

describe('MUX-89/91 never in exam simulation', () => {
  it('MentorQuestionEntry renders nothing in exam mode, even when available', () => {
    const out = renderToStaticMarkup(createElement(MentorQuestionEntry, { questionId: 5, wasCorrect: false, answered: true, examMode: true, placement: 'answer', lang: 'de' }));
    expect(out).toBe('');
  });
  it('renders nothing before an answer', () => {
    expect(renderToStaticMarkup(createElement(MentorQuestionEntry, { questionId: 5, wasCorrect: null, answered: false, placement: 'answer', lang: 'de' }))).toBe('');
  });
  it('server HTML of any entry is empty (availability is client-only)', () => {
    expect(renderToStaticMarkup(createElement(MentorEntryLink, { surface: 'home_plan', from: 'home', mode: 'study', label: 'x' }))).toBe('');
  });
  it('src/app/exam/** imports nothing from components/mentor/entries and never sets mentorEntry', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const file of walk('src/app/exam')) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/components\/mentor\/entries/);
      expect(src, file).not.toMatch(/mentorEntry/);
    }
  });
  it('QuestionCard gates the entry on an explicit opt-in prop and quiz opts in', () => {
    const card = readFileSync('src/components/QuestionCard.tsx', 'utf8');
    expect(card).toMatch(/mentorEntry = false/);
    expect(card.match(/<MentorQuestionEntry[^>]*examMode=\{examMode\}/g)?.length).toBe(3); // a-mentor-question-entry-v2 adds the Erklärung pane entry
    expect(readFileSync('src/app/quiz/page.tsx', 'utf8')).toMatch(/\n\s+mentorEntry\n/);
  });
  it('Sidebar (and its mentor item) stays hidden on /quiz and /exam', () => {
    expect(readFileSync('src/components/Sidebar.tsx', 'utf8')).toMatch(/pathname\.startsWith\("\/quiz"\) \|\| pathname\.startsWith\("\/exam"\)/);
  });
});

describe('MUX-48 mentor feedback tag', () => {
  it('tags /mentor and its sub-paths only', () => {
    expect(feedbackSource('/mentor')).toBe('mentor');
    expect(feedbackSource('/mentor/packages')).toBe('mentor');
    expect(feedbackSource('/mentoring')).toBeUndefined();
    expect(feedbackSource('/quiz')).toBeUndefined();
  });
  it('admin filter matches the tag or an older /mentor page', () => {
    expect(isMentorFeedback({ source: 'mentor' })).toBe(true);
    expect(isMentorFeedback({ pathname: '/mentor' })).toBe(true);
    expect(isMentorFeedback({ pathname: '/quiz', source: 'guidance' })).toBe(false);
    expect(isMentorFeedback(null)).toBe(false);
  });
});

describe('MUX-110 settings helpers', () => {
  it('names known packages and nothing for unknown ids', () => {
    expect(mentorPackageName('mentor_basis', 'de')).toBe('Mentor Basis');
    expect(mentorPackageName('included_pro_monthly', 'de')).toBeNull();
    expect(mentorPackageName(undefined, 'en')).toBeNull();
  });
  it('included allowance copy uses the server number, never a hardcoded 50', () => {
    expect(entryT('settings_included', 'de', { n: 30 })).toBe('Ihr Tarif enthält 30 Credits für den KI-Mentor je 30 Tage');
    expect(readFileSync('src/components/mentor/entries/MentorSettingsCard.tsx', 'utf8')).not.toMatch(/\b50\b/);
  });
});
