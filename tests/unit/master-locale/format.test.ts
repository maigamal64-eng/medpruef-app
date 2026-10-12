import { describe, expect, it } from 'vitest';
import { formatClock, formatCount, formatDate, formatDuration, formatMoney, formatNumber, formatPercent, formatTime, NNBSP, pluralCategory, UNKNOWN_VALUE, unknownValueLabel } from '@/lib/master-locale/format';

describe('UX-GLOBAL-03 formatter', () => {
  it('groups German with de-DE and English with en-US', () => {
    expect(formatNumber(7080, 'de')).toBe('7.080');
    expect(formatNumber(7080, 'en')).toBe('7,080');
  });
  it('keeps Latin digits for Arabic (pick-arabic-digits A)', () => {
    expect(formatNumber(1234, 'ar')).toBe('1,234');
    expect(formatMoney(4900, 'ar')).toBe('49 €');
    expect(formatPercent(74, 'ar')).toBe('74%');
  });
  it('renders percent with the symbol, German with a narrow no-break space', () => {
    expect(formatPercent(74, 'de')).toBe(`74${NNBSP}%`);
    expect(formatPercent(74, 'en')).toBe('74%');
    expect(formatPercent(null, 'de')).toBeNull();
  });
  it('formats money with exact cents, never a rounded estimate', () => {
    expect(formatMoney(1900, 'de')).toBe(`19${NNBSP}€`);
    expect(formatMoney(1633, 'de')).toBe(`16,33${NNBSP}€`);
    expect(formatMoney(1633, 'en')).toBe('16.33 €');
    expect(formatMoney(16.3, 'de')).toBeNull();
  });
  it('uses plural rules with written units', () => {
    expect(formatCount(1, 'day', 'de')).toBe('1 Tag');
    expect(formatCount(2, 'day', 'de')).toBe('2 Tage');
    expect(formatCount(1, 'question', 'en')).toBe('1 question');
    expect(formatCount(1200, 'question', 'de')).toBe('1.200 Fragen');
  });
  it('knows three Russian forms and six Arabic categories', () => {
    expect([pluralCategory(1, 'ru'), pluralCategory(3, 'ru'), pluralCategory(5, 'ru')]).toEqual(['one', 'few', 'many']);
    const ru = { one: '{n} вопрос', few: '{n} вопроса', many: '{n} вопросов', other: '{n} вопроса' };
    expect(formatCount(21, ru, 'ru')).toBe('21 вопрос');
    expect(formatCount(22, ru, 'ru')).toBe('22 вопроса');
    expect(formatCount(25, ru, 'ru')).toBe('25 вопросов');
    expect(new Set([0, 1, 2, 3, 11, 100].map((n) => pluralCategory(n, 'ar'))).size).toBe(6);
  });
  it('falls back to English unit forms for an unreviewed overlay', () => {
    expect(formatCount(2, 'day', 'ru')).toBe('2 days');
  });
  it('formats dates in Vienna time with year only outside the current year', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(formatDate('2026-11-14', 'de', 'long', { now })).toBe('14. November');
    expect(formatDate('2027-03-12', 'de', 'short', { now })).toBe('12. März 2027');
    expect(formatDate('2026-10-19', 'de', 'short', { now })).toBe('19. Okt.');
    expect(formatDate('2026-03-12', 'de', 'numeric', { now })).toBe('12.03.');
    expect(formatDate('2026-11-14', 'en', 'long', { now, withYear: true })).toBe('November 14, 2026');
    // 23:30 UTC on 31 Dec is already 1 Jan in Vienna; de-AT month names (Jänner)
    expect(formatDate('2026-12-31T23:30:00Z', 'de', 'long', { now })).toBe('1. Jänner 2027');
    expect(formatDate('not a date', 'de')).toBeNull();
  });
  it('formats 24 h times, durations and running clocks', () => {
    expect(formatTime('2026-10-12T19:40:00Z', 'de')).toBe('21:40');
    expect(formatDuration((2 * 60 + 14) * 60000, 'de')).toBe('2 Std. 14 Min.');
    expect(formatDuration(5 * 60000, 'en')).toBe('5 min');
    expect(formatClock(3723)).toBe('01:02:03');
  });
  it('never renders unknown as 0 and never uses an en or em dash', () => {
    expect(formatNumber(undefined, 'de')).toBeNull();
    expect(UNKNOWN_VALUE).toBe('-');
    expect(unknownValueLabel('failed', 'de')).toBe('Nicht verfügbar');
    expect(unknownValueLabel('empty', 'de')).toBe('Noch keine Daten');
    for (const v of [formatDuration(60000, 'de'), formatDate('2026-11-14', 'de'), formatPercent(5, 'de')]) expect(v).not.toMatch(/[–—]/);
  });
});
