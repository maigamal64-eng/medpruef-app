import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENTITLEMENTS, HISTORY_LIST_DECISION, canUse, type Audience } from '@/lib/entitlements';
import { HISTORY_STRINGS, historyLang, historyLocale, th } from '@/lib/i18n-history';
import {
  comparableKey,
  filterCounts,
  flaggedSet,
  formatPct,
  groupRows,
  isAttemptId,
  legacyDetailHref,
  matchesFilter,
  missedIds,
  overviewOf,
  pageCount,
  pageSlice,
  parseListState,
  pickTrend,
  runGroup,
  stemPreview,
  thresholdChip,
  verdictOf,
  streakText,
  trendDeltaText,
  wallDataLine,
  type AttemptRow,
  type ReviewQuestion,
} from '@/app/history/_parts/history-rules';

const ID = '71d520a8-8e45-4d6b-9897-63ec4388a07c';
let seq = 0;
function row(over: Partial<AttemptRow> & { config?: Record<string, unknown> | null } = {}): AttemptRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    exam_type: 'kenntnispruefung',
    title: 'Prüfungssimulation',
    correct_count: 60,
    total_count: 100,
    score_pct: 60,
    completed_at: `2026-10-${String((seq % 27) + 1).padStart(2, '0')}T10:00:00Z`,
    ...over,
  };
}

describe('entitlements: pick-ux-exm-38 B', () => {
  it('opens the read-only list to every signed-in audience and keeps the review Pro', () => {
    for (const a of ['free', 'trial', 'pro', 'lapsed'] as Audience[]) expect(canUse('history_list', a)).toBe(true);
    expect(canUse('history_list', 'guest')).toBe(false);
    for (const a of ['free', 'lapsed', 'guest'] as Audience[]) expect(canUse('history', a)).toBe(false);
    expect(canUse('history', 'pro')).toBe(true);
    expect(HISTORY_LIST_DECISION).toMatchObject({ pick: 'B', open: 'history_list', proOnly: 'history' });
    expect(Object.keys(ENTITLEMENTS)).toContain('history_list');
  });
});

describe('threshold chip (UX-EXM-41)', () => {
  it('shows a chip only for overall threshold rules and legacy full SIP runs', () => {
    expect(thresholdChip(row({ score_pct: 66, config: { kind: 'mcq', part: 'all', passRuleId: 'overall-60' } }))).toBe('over');
    expect(thresholdChip(row({ score_pct: 59.9, config: { kind: 'mcq', part: 'all', passRuleId: 'overall-60' } }))).toBe('under');
    expect(thresholdChip(row({ score_pct: 60, config: { kind: 'mcq', part: 'sip4', passRuleId: 'sip-overall-and-blocks-60' } }))).toBe('over');
    expect(thresholdChip(row({ score_pct: 40, config: { part: 'all' } }))).toBe('under');
    expect(thresholdChip(row({ score_pct: 40, config: { part: 'all', passRuleId: null } }))).toBe('under');
  });
  it('never shows a chip for custom, KAF, other rules, other legacy banks or summary rows', () => {
    expect(thresholdChip(row({ config: { part: 'custom', passRuleId: 'overall-60' } }))).toBeNull();
    expect(thresholdChip(row({ config: { kind: 'kaf', part: 'all', passRuleId: 'overall-60' } }))).toBeNull();
    expect(thresholdChip(row({ config: { part: 'all', passRuleId: 'stp-six-fields-60' } }))).toBeNull();
    expect(thresholdChip(row({ exam_type: 'kmp_innsbruck', config: { part: 'all' } }))).toBeNull();
    expect(thresholdChip(row({ config: { part: 'sip5' } }))).toBeNull();
    expect(thresholdChip(row({ config: null }))).toBeNull();
    expect(thresholdChip(row())).toBeNull();
  });
});

describe('groups and comparable runs (UX-EXM-41/42)', () => {
  it('groups by part and kind; summary rows go under Simulationen', () => {
    expect(runGroup(row({ config: { part: 'all' } }))).toBe('full');
    expect(runGroup(row({ config: { part: 'sip4' } }))).toBe('part');
    expect(runGroup(row({ config: { part: 'custom' } }))).toBe('custom');
    expect(runGroup(row({ config: { kind: 'kaf', part: 'all' } }))).toBe('kaf');
    expect(runGroup(row())).toBe('simulations');
    const grouped = groupRows([row({ config: { part: 'custom' } }), row({ config: { part: 'all' } }), row()]);
    expect(grouped.map((g) => g.group)).toEqual(['full', 'custom', 'simulations']);
  });
  it('compares by preset, then legacy part, then summary title; custom never', () => {
    expect(comparableKey(row({ config: { presetId: 'kp_full', part: 'all' } }))).toBe('preset:kp_full');
    expect(comparableKey(row({ config: { part: 'all' } }))).toBe('part:kenntnispruefung:all');
    expect(comparableKey(row({ config: { part: 'custom', presetId: 'x' } }))).toBeNull();
    expect(comparableKey(row({ title: 'SIP4a Teilprüfung' }))).toBe('title:kenntnispruefung:SIP4a Teilprüfung');
  });
  it('draws a trend only with three or more comparable runs', () => {
    const full = (pct: number, day: number) => row({ score_pct: pct, completed_at: `2026-09-${String(day).padStart(2, '0')}T08:00:00Z`, config: { part: 'all', presetId: 'kp_full' } });
    expect(pickTrend([])).toBeNull();
    expect(pickTrend([full(50, 1)])).toBeNull();
    expect(pickTrend([full(50, 1), full(55, 2)])).toBeNull();
    expect(pickTrend([full(50, 1), full(55, 2), row({ config: { part: 'custom' } })])).toBeNull();
    const t = pickTrend([full(58, 3), full(50, 1), full(55, 2)]);
    expect(t?.points.map((p) => p.pct)).toEqual([50, 55, 58]);
    expect(t?.delta).toBe(3);
    expect(t?.group).toBe('full');
  });
});

describe('overview and formatting (UX-EXM-40)', () => {
  it('takes the count from the server and never shows 0 before a load', () => {
    expect(overviewOf(null, null)).toEqual({ best: null, latest: null, count: null });
    expect(overviewOf([], 0)).toEqual({ best: null, latest: null, count: 0 });
    const rows = [row({ score_pct: 46, completed_at: '2026-10-01T10:00:00Z' }), row({ score_pct: 83, completed_at: '2026-09-01T10:00:00Z' }), row({ score_pct: 66, completed_at: '2026-10-05T10:00:00Z' })];
    expect(overviewOf(rows, 120)).toEqual({ best: 83, latest: 66, count: 120 });
  });
  it('formats de-AT numbers and units; unreviewed languages render English', () => {
    expect(historyLocale('de')).toBe('de-AT');
    expect(historyLang('ar')).toBe('en');
    expect(formatPct(66.4, 'de')).toBe('66 %');
    expect(formatPct(66.4, 'en')).toBe('66%');
    expect(streakText(6, 'de')).toBe('6 Tage');
    expect(streakText(1, 'de')).toBe('1 Tag');
    expect(streakText(null, 'de')).toBe('-');
  });
});

describe('detail rules (UX-EXM-39)', () => {
  const q = (over: Partial<ReviewQuestion>): ReviewQuestion => ({ question_id: 1, removed: false, options: [], is_correct: false, ...over });
  const qs: ReviewQuestion[] = [
    q({ question_id: 1, is_correct: true, selected_texts: ['A'] }),
    q({ question_id: 2, selected_texts: ['B'] }),
    q({ question_id: 3, selected_texts: [] }),
    q({ question_id: 4, options: [{ text: 'x', is_correct: false, is_selected: true }] }),
    q({ question_id: 5, removed: true, selected_texts: [] }),
  ];
  it('treats an unanswered question as neutral, never wrong', () => {
    expect(qs.map(verdictOf)).toEqual(['correct', 'wrong', 'open', 'wrong', 'open']);
  });
  it('counts and filters wrong, open, flagged and all', () => {
    const flagged = flaggedSet([2, 3, 'x', -1]);
    expect(filterCounts(qs, flagged)).toEqual({ wrong: 2, open: 2, flagged: 2, all: 5 });
    expect(qs.filter((x) => matchesFilter(x, 'flagged', flagged)).map((x) => x.question_id)).toEqual([2, 3]);
  });
  it('hands wrong and open items still in the bank to the quiz', () => {
    expect(missedIds(qs)).toEqual([2, 3, 4]);
  });
  it('previews 80 characters and pages 40 at a time', () => {
    expect(stemPreview('a'.repeat(100))).toHaveLength(81);
    expect(stemPreview('  kurz \n Frage ')).toBe('kurz Frage');
    const items = Array.from({ length: 95 }, (_, i) => i);
    expect(pageCount(items.length)).toBe(3);
    expect(pageSlice(items, 3)).toEqual(items.slice(80));
    expect(pageSlice(items, 9)).toEqual(items.slice(80));
  });
});

describe('routes and list state (UX-EXM-36)', () => {
  it('maps ?attempt=<id> onto /history/<id> and rejects anything else', () => {
    expect(legacyDetailHref(`?attempt=${ID}`)).toBe(`/history/${ID}`);
    expect(legacyDetailHref('?attempt=../admin')).toBeNull();
    expect(legacyDetailHref('')).toBeNull();
    expect(isAttemptId(ID)).toBe(true);
    expect(isAttemptId('not-an-id')).toBe(false);
  });
  it('parses stored tab and scroll defensively', () => {
    expect(parseListState('{"tab":"questions","scrollY":420.4}')).toEqual({ tab: 'questions', scrollY: 420 });
    expect(parseListState('{"tab":"admin"}')).toBeNull();
    expect(parseListState('not json')).toBeNull();
    expect(parseListState(null)).toBeNull();
  });
});

describe('copy (Sie, no dashes, no pass promise)', () => {
  it('names the stored data on the wall and keeps the results', () => {
    expect(wallDataLine(3, 66.2, 'de')).toBe('3 Prüfungen sind gespeichert, zuletzt 66 Prozent.');
    expect(wallDataLine(1, 50, 'de')).toBe('1 Prüfung ist gespeichert, zuletzt 50 Prozent.');
    expect(wallDataLine(0, null, 'de')).toBeNull();
    expect(th('wall_kept', 'de')).toBe('Ihre Ergebnisse bleiben gespeichert.');
    expect(th('subtitle_full', 'de')).toBe('Ihre gespeicherten Prüfungen und beantworteten Fragen.');
    expect(trendDeltaText(-4, 'de')).toBe('4 Prozentpunkte weniger als beim vorherigen Lauf.');
  });
  it('falls back to English for unreviewed languages and never returns a raw key', () => {
    expect(th('to_pro', 'ru')).toBe('Go to Pro');
    expect(th('to_pro', 'de')).toBe('Zu Pro');
    expect(th('row_correct', 'de', { correct: 3, total: 4 })).toBe('3 von 4 richtig');
  });
  it('dictionary has no dashes, no du-form and no pass wording', () => {
    for (const [key, entry] of Object.entries(HISTORY_STRINGS)) {
      for (const text of [entry.de, entry.en]) {
        expect(text, key).not.toMatch(/[–—]/);
        expect(text, key).not.toMatch(/\bbestanden\b|\bpassed\b|\bpass rate\b/i);
      }
      expect(entry.de, key).not.toMatch(/\b(du|dich|dir|dein|deine|deinen|deiner|deines)\b/i);
    }
  });
  it('history sources carry no inline de/en ternary, no getLang and no raw amber', () => {
    const dir = resolve(__dirname, '../../../src/app/history');
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/\bgetLang\s*\(/);
      expect(text, f).not.toMatch(/\b(?:lang|l|activeLang|uiLang|language)\s*===?\s*["']de["']\s*\?/);
      expect(text, f).not.toMatch(/#F4A261|medpruef_lang\b|accent-teal|Crown/);
      expect(text, f).not.toMatch(/[–—]/);
    }
  });
});
