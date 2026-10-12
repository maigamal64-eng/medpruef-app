import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUYP_COPY, tp, puypLang } from '@/lib/i18n-puyp';

const root = resolve(__dirname, '../../..');
const values = Object.values(PUYP_COPY);

describe('a24 PUYP copy rules', () => {
  it('has German and English for every key', () => {
    for (const v of values) { expect(v.de.length).toBeGreaterThan(0); expect(v.en.length).toBeGreaterThan(0); }
  });
  it('uses no em or en dashes', () => {
    for (const v of values) expect(`${v.de} ${v.en}`).not.toMatch(/[–—]/);
  });
  it('German is formal Sie', () => {
    for (const v of values) expect(v.de).not.toMatch(/\b(du|dein\w*|dir|dich)\b/i);
  });
  it('names only real plans and the app vocabulary, no pass rates', () => {
    for (const v of values) {
      const text = `${v.de} ${v.en}`;
      expect(text).not.toMatch(/Qbank|Premium|12-Monat|12-month|Fragebank\b/i);
      expect(text).not.toMatch(/Bestehensquote|pass rate|\d+ ?% (der|of) (Teilnehmer|learners)/i);
    }
  });
  it('carries the decided lines', () => {
    expect(tp('title', 'de')).toBe('Wie lief Ihre echte Prüfung?');
    expect(tp('debrief', 'de')).toBe('Schade. Wir helfen Ihnen, den nächsten Termin gut vorzubereiten.');
    expect(tp('uploadTooSlow', 'de')).toBe('Upload zu langsam. Bitte mit besserer Verbindung erneut versuchen.');
    expect(tp('reload', 'de')).toBe('Erneut laden');
    expect(tp('failHelperBelowGate', 'de', { pct: 70, current: '41,2' })).toContain('mindestens 70 %');
  });
  it('unreviewed languages fall back to English', () => {
    expect(tp('title', 'ar')).toBe(PUYP_COPY.title.en);
    expect(puypLang('tr')).toBe('en');
  });
  it('page files read no narrow language and keep no tooltip-only reasons', () => {
    const dir = resolve(root, 'src/app/dashboard/exam-result');
    const files = ['page.tsx', ...readdirSync(resolve(dir, '_parts')).map((f) => `_parts/${f}`)];
    for (const f of files) {
      const src = readFileSync(resolve(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\bgetLang\s*\(/);
      expect(src, f).not.toMatch(/\b(?:lang|l)\s*===?\s*["']de["']\s*\?/);
      expect(src, f).not.toMatch(/<(?:button|Button)\b[^>]*\stitle=/);
      expect(src, f).not.toMatch(/12-Monat|Premium/);
    }
  });
});
