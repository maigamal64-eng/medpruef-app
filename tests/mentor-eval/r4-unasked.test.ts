import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkCase, mkCtx, mkOutcome } from './helpers';
import { scoreCase } from './lib/score';
import type { GoldenFile } from './lib/types';

describe('MUX-07 multilingual and multi-turn unasked fact gate', () => {
  it('rejects neighbouring facts even when the cited truth contains them, in every language', () => {
    for (const lang of ['de', 'en', 'ru', 'uk', 'tr', 'fr', 'ar'] as const) {
      const c = mkCase({ lang, unasked_fact_gate: true, expect: { kind: 'answer', cite_any: ['a.b'], must_dates: ['2026-10-19'] } });
      const ctx = mkCtx({ truthText: () => '2026-10-19, 2027-01-07, 150 EUR, 60%' });
      const valid = scoreCase(c, mkOutcome({ blocks: [{ text: '2026-10-19.', fact_ids: ['a.b'] }] }), ctx);
      expect(valid.critical).toEqual([]);
      const invalid = scoreCase(c, mkOutcome({ blocks: [{ text: '2026-10-19. 2027-01-07. 150 EUR. 60%.', fact_ids: ['a.b'] }] }), ctx);
      expect(invalid.critical.some(s => s.startsWith('unasked_date:'))).toBe(true);
      expect(invalid.critical).toContain('unasked_fee:150');
      expect(invalid.failures).toContain('unasked_percent:60');
    }
  });
  it('requires the check in every multilingual case and every multi-turn golden case', () => {
    const multilingual = JSON.parse(readFileSync('tests/mentor-eval/r1-multilingual.json', 'utf8')) as GoldenFile;
    const golden = JSON.parse(readFileSync('tests/mentor-eval/golden.json', 'utf8')) as GoldenFile;
    expect(multilingual.cases.length).toBeGreaterThan(0);
    expect(multilingual.cases.every(c => c.unasked_fact_gate)).toBe(true);
    const followups = golden.cases.filter(c => c.history?.length);
    expect(followups.length).toBeGreaterThan(0);
    expect(followups.every(c => c.unasked_fact_gate)).toBe(true);
  });
});

describe('MUX-05 first visible deadline line release gate', () => {
  it('requires the closing date, tool-owned days and one bold line, with all languages prepared', () => {
    const file = JSON.parse(readFileSync('tests/mentor-eval/r4-deadlines.json', 'utf8')) as GoldenFile;
    expect(file.cases.map(c => c.lang)).toEqual(['de', 'en', 'ru', 'uk', 'tr', 'fr', 'ar']);
    for (const c of file.cases) {
      expect(c.expect.deadline_first).toEqual({ closes: '2026-10-19', days_left: 7 });
      const accepted = scoreCase(c, mkOutcome({ blocks: [{ text: '**2026-10-19, 7 days left**\n2026-11-18.', fact_ids: ['sitting.sip4a.2026-11-18.wien.registration'] }] }), mkCtx());
      expect(accepted.failures.filter(f => f.startsWith('deadline_first'))).toEqual([]);
      for (const text of ['**2026-11-18, 7 days left**\n2026-10-19.', '**2026-10-19, 8 days left**\n2026-11-18.', '2026-10-19, 7 days left\n2026-11-18.']) {
        const rejected = scoreCase(c, mkOutcome({ blocks: [{ text, fact_ids: ['sitting.sip4a.2026-11-18.wien.registration'] }] }), mkCtx());
        expect(rejected.failures.some(f => f.startsWith('deadline_first'))).toBe(true);
      }
    }
  });
});
