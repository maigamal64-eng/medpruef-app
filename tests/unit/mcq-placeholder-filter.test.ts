import { describe, it, expect } from 'vitest';
import {
  filterDisplayableChoices,
  isPlaceholderChoice,
  buildMCQFromChoices,
  type StoredChoice,
} from '@/lib/mcq';

const c = (text: string, correct = false, position = 0): StoredChoice => ({
  text,
  correct,
  position,
});

describe('isPlaceholderChoice', () => {
  it('treats bare punctuation and blanks as placeholders', () => {
    for (const t of ['?', '-', '--', '  ?  ', '', '   ', '.', '?.', '–', '_']) {
      expect(isPlaceholderChoice({ text: t })).toBe(true);
    }
  });

  it('never treats real option text as a placeholder', () => {
    for (const t of ['21 %', 'GGT 95 U/l', 'Keine der genannten', '?-Fehler des Typs I']) {
      expect(isPlaceholderChoice({ text: t })).toBe(false);
    }
  });

  it('NEVER classifies a correct choice as a placeholder', () => {
    expect(isPlaceholderChoice({ text: '?', correct: true })).toBe(false);
  });
});

describe('filterDisplayableChoices', () => {
  it('drops a single placeholder, leaving 4 real options', () => {
    const input = [c('A', true), c('B'), c('C'), c('D'), c('?')];
    expect(filterDisplayableChoices(input).map(o => o.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('drops three placeholders, leaving 2 real options', () => {
    const input = [c('A', true), c('B'), c('?'), c('-'), c('?')];
    expect(filterDisplayableChoices(input).map(o => o.text)).toEqual(['A', 'B']);
  });

  it('keeps the key even when the key itself looks like a placeholder', () => {
    const input = [c('?', true), c('B'), c('C'), c('?'), c('?')];
    const out = filterDisplayableChoices(input);
    expect(out.some(o => o.correct)).toBe(true);
    expect(out.map(o => o.text)).toEqual(['?', 'B', 'C']);
  });

  it('does NOT filter when it would leave fewer than 2 options', () => {
    const input = [c('A', true), c('?'), c('?'), c('?'), c('?')];
    expect(filterDisplayableChoices(input)).toEqual(input);
  });

  it('does NOT filter when no correct option would survive', () => {
    const input = [c('?', true), c('?'), c('B'), c('C')];
    const out = filterDisplayableChoices(input);
    expect(out.some(o => o.correct)).toBe(true);
  });

  it('preserves every correct option in a multi-select item', () => {
    const input = [c('A', true), c('B', true), c('C', true), c('D'), c('?')];
    const out = filterDisplayableChoices(input);
    expect(out.filter(o => o.correct)).toHaveLength(3);
    expect(out).toHaveLength(4);
  });
});

describe('buildMCQFromChoices', () => {
  it('serves no placeholder and keeps exactly one key', () => {
    const out = buildMCQFromChoices([c('A', true), c('B'), c('C'), c('D'), c('?')]);
    expect(out).toHaveLength(4);
    expect(out.some(o => o.text === '?')).toBe(false);
    expect(out.filter(o => o.correct)).toHaveLength(1);
  });

  it('keeps multi-correct counts intact after filtering', () => {
    const out = buildMCQFromChoices([c('A', true), c('B', true), c('C'), c('?'), c('-')]);
    expect(out).toHaveLength(3);
    expect(out.filter(o => o.correct)).toHaveLength(2);
  });
});
