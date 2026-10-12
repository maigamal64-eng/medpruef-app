import { DataResponseError, isRecord } from './async-data';
import { isNoteSourceType } from './notes';

export const LIBRARY_PAGE_SIZE = 200;
export interface LibraryPage<T> { notes: T[]; count: number; offset: number }

/** A malformed read must never be treated as an empty library. */
export function isLibraryPage<T>(value: unknown): value is LibraryPage<T> {
  return isRecord(value) && Array.isArray(value.notes) &&
    Number.isInteger(value.count) && Number(value.count) >= 0 &&
    Number.isInteger(value.offset) && Number(value.offset) >= 0 &&
    value.notes.every(note => isRecord(note) && typeof note.id === 'string' &&
      typeof note.title === 'string' && isNoteSourceType(note.source_type) &&
      isRecord(note.content) && Array.isArray(note.content.blocks) &&
      note.content.blocks.every(block => isRecord(block) &&
        (block.type === 'concept' ? typeof block.front === 'string' && typeof block.back === 'string' :
          ['keyfact', 'pitfall', 'mnemonic'].includes(String(block.type)) && typeof block.text === 'string')) &&
      (note.content.refs === undefined || (Array.isArray(note.content.refs) && note.content.refs.every(ref => isRecord(ref) && typeof ref.label === 'string'))) &&
      (note.exam_type == null || typeof note.exam_type === 'string') && (note.topic == null || typeof note.topic === 'string') &&
      Array.isArray(note.tags) && note.tags.every(tag => typeof tag === 'string') &&
      typeof note.created_at === 'string' && typeof note.updated_at === 'string');
}
export function mergeLibraryPage<T extends { id: string }>(previous: T[], page: T[], append: boolean): T[] {
  const merged = new Map((append ? previous : []).map(note => [note.id, note]));
  for (const note of page) merged.set(note.id, note);
  return [...merged.values()];
}
export function libraryReadFailure(error: unknown): { status: number; weakConnection: boolean } {
  return { status: error instanceof DataResponseError ? error.status : error instanceof SyntaxError ? 502 : 0,
    weakConnection: !(error instanceof DataResponseError) && !(error instanceof SyntaxError) };
}
/** Only an accepted, valid server schedule can move the review forward. */
export async function checkedLibraryReview(response: Response): Promise<{ next_review_at: string; interval_days: number }> {
  if (!response.ok) throw new DataResponseError(response.status);
  const data: unknown = await response.json();
  if (!isRecord(data) || data.ok !== true || typeof data.next_review_at !== 'string' ||
    !Number.isFinite(Date.parse(data.next_review_at)) || !Number.isInteger(data.interval_days) || Number(data.interval_days) < 0) {
    throw new DataResponseError(502);
  }
  return { next_review_at: data.next_review_at, interval_days: Number(data.interval_days) };
}
