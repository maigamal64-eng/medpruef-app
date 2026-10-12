import { describe, expect, it } from 'vitest';
import {
  FYP_INITIAL,
  clampStep,
  examTypeOf,
  initialStep,
  parseStepParam,
  restoreState,
  searchWithStep,
  serializeState,
  stepParam,
} from '@/app/find-your-path/fyp-state';
import { t } from '@/lib/i18n';
import { OFFICIAL_KEYS_BY_BANK } from '@/lib/exam-dates';
import { buildStudyPath } from '@/lib/studyPath';
import { buildAuthHref } from '@/lib/auth-entry';

describe('UX-PUB-33 find-your-path URL step', () => {
  it('parses 1-based steps and the result view', () => {
    expect(parseStepParam('1')).toBe(0);
    expect(parseStepParam('3')).toBe(2);
    expect(parseStepParam('result')).toBe('result');
    for (const bad of [null, undefined, '', '0', '4', '12', 'x', '-1']) expect(parseStepParam(bad)).toBeNull();
  });
  it('round-trips step params and keeps other query params', () => {
    for (const s of [0, 1, 2, 'result'] as const) expect(parseStepParam(stepParam(s))).toBe(s);
    expect(searchWithStep('?utm_source=ig&step=1', 2)).toBe('?utm_source=ig&step=3');
    expect(searchWithStep('', 'result')).toBe('?step=result');
  });
  it('clamps later steps to step 1 without a real bank', () => {
    expect(clampStep(2, null)).toBe(0);
    expect(clampStep('result', 'unsure')).toBe(0);
    expect(clampStep('result', 'pharma')).toBe('result');
    expect(examTypeOf('unsure')).toBeNull();
    expect(examTypeOf('pharma')).toBe('pharma');
  });
});

describe('UX-PUB-33 find-your-path stored selection', () => {
  it('restores a valid record and the URL step wins', () => {
    const raw = serializeState({ route: 'pharma', examDate: '2027-01-18', weak: ['Pharmakologie'], dailyGoal: 30, step: 1 });
    const s = restoreState(raw);
    expect(s).toEqual({ route: 'pharma', examDate: '2027-01-18', weak: ['Pharmakologie'], dailyGoal: 30, step: 1 });
    expect(initialStep(parseStepParam('result'), s)).toBe('result');
    expect(initialStep(null, s)).toBe(1);
  });
  it('falls back to defaults on broken or hostile records', () => {
    expect(restoreState(null)).toEqual(FYP_INITIAL);
    expect(restoreState('{not json')).toEqual(FYP_INITIAL);
    expect(restoreState('"text"')).toEqual(FYP_INITIAL);
    const s = restoreState(JSON.stringify({ route: 'admin', examDate: '18.01.2027', weak: [1, 'x'], dailyGoal: 1000, step: 'result' }));
    expect(s).toEqual({ route: null, examDate: '', weak: ['x'], dailyGoal: 20, step: 0 });
    expect(initialStep(parseStepParam('3'), s)).toBe(0);
  });
});

describe('UX-PUB-33 pharma bank and copy', () => {
  it('has official keys, a study path and an auth entry for pharma', () => {
    expect(OFFICIAL_KEYS_BY_BANK.pharma.length).toBeGreaterThan(0);
    const path = buildStudyPath('2099-06-01', 'pharma', new Date('2099-01-01T10:00:00Z'));
    expect(path?.daysLeft).toBeGreaterThan(0);
    expect(buildAuthHref({ intent: 'free', exam: 'pharma', next: '/quiz?exam=pharma&free=1' }))
      .toMatch(/^\/login\?mode=register&next=.*&intent=free&exam=pharma$/);
  });
  it('uses the picked exam names and formal Sie without dashes', async () => {
    expect(t('fyp_s1_title', 'de')).toBe('Welche Fragenbank passt zu Ihnen?');
    expect(t('fyp_s1_title', 'en')).toBe('Which question bank fits you?');
    expect(t('fyp_route_kp_name', 'de')).toBe('SIP4a / SIP5a Wien');
    expect(t('fyp_route_kp_name', 'en')).toBe('SIP4a / SIP5a Vienna');
    expect(t('fyp_route_pharma_name', 'de')).toBe('Pharmakologie / Rezeptierkunde');
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/lib/i18n.ts', 'utf8');
    const lines = src.split('\n').filter(l => /^\s*'fyp_/.test(l));
    expect(lines.length).toBeGreaterThan(60);
    for (const l of lines) {
      const de = l.match(/de: (".*?"|'.*?'), en:/)?.[1] ?? '';
      expect(de, l).not.toMatch(/\b(du|dich|dir|dein\w*)\b|\b(Wähle|Kläre|Tippe|Mach|Finde|Zeig)\b|fang an/i);
      expect(l, l).not.toMatch(/[–—]/);
    }
  });
});
