import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderedLanguage, resolveString, GERMAN_CONTENT } from '@/lib/master-locale/render';
import { LANGUAGE_DECISION, explanationTargets, settingsLanguages } from '@/lib/master-locale/language-decision';
import { EXPLANATION_LANGUAGES } from '@/lib/content-truth';
import { KNOWN_LANGS, LANGUAGE_HEAD_SCRIPT } from '@/lib/language-model';
import { t, registerOverlay, isRtl } from '@/lib/i18n';

describe('UX-GLOBAL-01/02 rendered language', () => {
  it('renders English LTR for a closed review gate, including Arabic', () => {
    expect(renderedLanguage('ar')).toEqual({ lang: 'en', dir: 'ltr' });
    expect(renderedLanguage('ru')).toEqual({ lang: 'en', dir: 'ltr' });
    expect(renderedLanguage('de')).toEqual({ lang: 'de', dir: 'ltr' });
    expect(isRtl('ar')).toBe(false);
  });
  it('renders reviewed Arabic right-to-left once its gate lifts', () => {
    expect(renderedLanguage('ar', ['de', 'en', 'ar'])).toEqual({ lang: 'ar', dir: 'rtl' });
  });
  it('falls back per key to English, never German, never a raw key', () => {
    const base = { de: 'Hallo', en: 'Hello' };
    expect(resolveString(base, 'ru', { k: 'Привет' }, 'k', 'x').text).toBe('Hello');
    expect(resolveString(base, 'ru', { k: 'Привет' }, 'k', 'x', ['de', 'en', 'ru'])).toEqual({ text: 'Привет', lang: 'ru' });
    expect(resolveString(base, 'ru', {}, 'k', 'x', ['de', 'en', 'ru'])).toEqual({ text: 'Hello', lang: 'en' });
    expect(resolveString(undefined, 'tr', undefined, 'k', 'fallback').text).toBe('fallback');
  });
  it('ignores a registered overlay while its language is unreviewed', () => {
    registerOverlay('tr', { mistakes_title: 'Hatalarım' });
    expect(t('mistakes_title', 'tr')).toBe(t('mistakes_title', 'en'));
    expect(t('mistakes_title', 'de')).toBe('Meine Fehler');
  });
  it('marks German exam content lang=de dir=ltr', () => {
    expect(GERMAN_CONTENT).toEqual({ lang: 'de', dir: 'ltr' });
    const card = readFileSync('src/components/QuestionCard.tsx', 'utf8');
    expect(card).toMatch(/data-question-heading lang="de" dir="ltr"/);
    expect(readFileSync('src/app/mistakes/page.tsx', 'utf8')).toMatch(/lang="de" dir="ltr">\{row\.question\}/);
  });
  it('head script names the rendered language before paint', () => {
    for (const [stored, expected] of [['de', 'de'], ['ar', 'en'], ['uk', 'en'], [null, 'de']] as const) {
      const el = { lang: '', dir: '' };
      runInNewContext(LANGUAGE_HEAD_SCRIPT, { document: { documentElement: el }, localStorage: { getItem: (k: string) => (k === 'medpruef-lang' ? stored : null) } });
      expect(el).toEqual({ lang: expected, dir: 'ltr' });
    }
  });
});

describe('LX-23 recorded language decision', () => {
  it('lists UI and explanation state with a reason for every language, Persian not planned', () => {
    for (const d of Object.values(LANGUAGE_DECISION)) expect(d.reason.length).toBeGreaterThan(10);
    expect(LANGUAGE_DECISION.fa).toMatchObject({ ui: 'none', explanations: 'none' });
    expect(LANGUAGE_DECISION.fa.reason).toMatch(/not planned/);
    expect(LANGUAGE_DECISION.ro.explanations).toBe('none');
  });
  it('matches the picker languages', () => {
    expect(settingsLanguages().sort()).toEqual([...KNOWN_LANGS].sort());
  });
  it('matches the translate route and the public claim source', () => {
    // a29: the route serves TRANSLATION_TARGETS from src/lib/explanation-translation.ts.
    const route = readFileSync('src/app/api/translate/route.ts', 'utf8');
    expect(route).toContain('new Set(TRANSLATION_TARGETS)');
    const owner = readFileSync('src/lib/explanation-translation.ts', 'utf8');
    const block = owner.slice(owner.indexOf('export const TRANSLATION_TARGETS'), owner.indexOf('] as const;', owner.indexOf('export const TRANSLATION_TARGETS')));
    const routeLangs = [...block.matchAll(/"([a-z]{2})"/g)].map((m) => m[1]).sort();
    expect(explanationTargets().sort()).toEqual(routeLangs);
    const claimed = (Object.keys(LANGUAGE_DECISION) as (keyof typeof LANGUAGE_DECISION)[]).filter((l) => LANGUAGE_DECISION[l].explanations === 'claimed');
    expect(claimed.sort()).toEqual([...EXPLANATION_LANGUAGES.claimed].sort());
    expect(explanationTargets().filter((l) => LANGUAGE_DECISION[l].explanations === 'unreviewed-label').sort()).toEqual([...EXPLANATION_LANGUAGES.unreviewed].sort());
    expect(explanationTargets().filter((l) => LANGUAGE_DECISION[l].explanations === 'pending-[name]')).toEqual([...EXPLANATION_LANGUAGES.pendingSignoff]);
  });
});
