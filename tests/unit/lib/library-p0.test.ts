import { describe, expect, it } from 'vitest';
import { checkedJson, DataResponseError } from '@/lib/async-data';
import { libraryP0Copy, libraryMigrationHintKey } from '@/lib/library-p0-copy';
import { checkedLibraryReview, isLibraryPage, libraryReadFailure, mergeLibraryPage } from '@/lib/library-p0-state';

const note = { id: 'note-1', title: 'Synthetic note', source_type: 'manual', content: { blocks: [{ type: 'concept', front: 'Prompt', back: 'Fixture answer' }] }, tags: [], created_at: '2026-01-01', updated_at: '2026-01-01' };
describe('Library P0 read and review contracts', () => {
  it('recognizes only confirmed successful empty pages as empty', async () => {
    await expect(checkedJson(Response.json({ notes: [], count: 0, offset: 0 }), isLibraryPage)).resolves.toEqual({ notes: [], count: 0, offset: 0 });
    for (const data of [{ notes: [] }, { notes: [null], count: 1, offset: 0 }, { notes: [{ ...note, content: { blocks: [null] } }], count: 1, offset: 0 }, { notes: [note], count: '1', offset: 0 }]) {
      await expect(checkedJson(Response.json(data), isLibraryPage)).rejects.toBeInstanceOf(DataResponseError);
    }
    await expect(checkedJson(Response.json({ notes: [], count: 0, offset: 0 }, { status: 500 }), isLibraryPage)).rejects.toMatchObject({ status: 500 });
  });
  it('appends a page beyond 200 and deduplicates ids while retaining previous notes', () => {
    const previous = Array.from({ length: 200 }, (_, i) => ({ id: String(i), title: 'Existing' }));
    const page = [{ id: '199', title: 'Updated' }, { id: '200', title: 'Last note' }];
    const result = mergeLibraryPage(previous, page, true);
    expect(result).toHaveLength(201); expect(result[199].title).toBe('Updated'); expect(result[200].title).toBe('Last note');
    expect(previous[199].title).toBe('Existing');
    expect(mergeLibraryPage(previous, [], false)).toEqual([]);
  });
  it('does not blame connectivity for a server or malformed JSON failure', () => {
    expect(libraryReadFailure(new DataResponseError(500))).toEqual({ status: 500, weakConnection: false });
    expect(libraryReadFailure(new SyntaxError())).toEqual({ status: 502, weakConnection: false });
    expect(libraryReadFailure(new TypeError('Failed to fetch')).weakConnection).toBe(true);
  });
  it('accepts only persisted server review results, with no fabricated intervals', async () => {
    const accepted = { ok: true, next_review_at: '2026-10-12T12:00:00.000Z', interval_days: 1 };
    await expect(checkedLibraryReview(Response.json(accepted))).resolves.toEqual({ next_review_at: accepted.next_review_at, interval_days: 1 });
    for (const invalid of [{ ok: false }, { ...accepted, next_review_at: 'invalid' }, { ...accepted, interval_days: -1 }, {}]) {
      await expect(checkedLibraryReview(Response.json(invalid))).rejects.toBeInstanceOf(DataResponseError);
    }
    await expect(checkedLibraryReview(Response.json(accepted, { status: 503 }))).rejects.toMatchObject({ status: 503 });
  });
  it('uses account scoped acknowledgement and English fallback without changing preference', () => {
    expect(libraryMigrationHintKey('account/a')).not.toBe(libraryMigrationHintKey('account/b'));
    expect(libraryMigrationHintKey('account/a')).toContain('account%2Fa');
    for (const language of ['ar', 'ru', 'uk', 'tr'] as const) expect(libraryP0Copy('migrationHint', language)).toBe(libraryP0Copy('migrationHint', 'en'));
    expect(libraryP0Copy('practice', 'de')).toBe('Üben');
  });
});
