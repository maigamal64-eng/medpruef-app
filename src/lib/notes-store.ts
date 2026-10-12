/** Account-scoped storage for per-question notes. */

import { getStoredSession } from "@/lib/auth";

export interface NoteEntry {
  id: string;
  text: string;
  /** epoch ms */
  updatedAt: number;
}

const ACCOUNT_PREFIX = "medpruef_notes_account_";
const LEGACY_PATTERN = /^medpruef_notes_(\d+)$/;

export function currentNotesUserId(): string | null {
  return getStoredSession()?.user?.id || null;
}

export function noteStorageKey(questionId: number, userId = currentNotesUserId()): string | null {
  if (!userId || !Number.isSafeInteger(questionId) || questionId <= 0) return null;
  return `${ACCOUNT_PREFIX}${encodeURIComponent(userId)}_${questionId}`;
}

export function noteQuestionIdFromKey(storageKey: string | null, userId = currentNotesUserId()): number | null {
  if (!storageKey || !userId) return null;
  const prefix = `${ACCOUNT_PREFIX}${encodeURIComponent(userId)}_`;
  if (!storageKey.startsWith(prefix)) return null;
  const suffix = storageKey.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  const id = Number(suffix);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function listNoteQuestionIds(userId = currentNotesUserId()): number[] {
  if (typeof window === "undefined" || !userId) return [];
  const ids = new Set<number>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const id = noteQuestionIdFromKey(localStorage.key(i), userId);
      if (id !== null) ids.add(id);
    }
  } catch {
    return [];
  }
  return Array.from(ids);
}

function newId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function parseEntries(raw: string): NoteEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr
          .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as Record<string, unknown>).text === "string")
          .map((e) => ({
            id: typeof e.id === "string" ? e.id : newId(),
            text: e.text as string,
            updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
          }));
      }
    } catch {
      // A malformed JSON value remains visible as its original text in legacy import only.
    }
  }
  return [{ id: "legacy", text: raw, updatedAt: Date.now() }];
}

/** Reads only this account's notes. Global legacy keys are deliberately excluded. */
export function readNotes(questionId: number, userId = currentNotesUserId()): NoteEntry[] {
  if (typeof window === "undefined") return [];
  const storageKey = noteStorageKey(questionId, userId);
  if (!storageKey) return [];
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? parseEntries(raw) : [];
  } catch {
    return [];
  }
}

/** Legacy notes are exposed only to the explicit, warned import action. */
export function readLegacyNotes(): { question_id: number; entries: NoteEntry[] }[] {
  if (typeof window === "undefined") return [];
  const items: { question_id: number; entries: NoteEntry[] }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      const match = storageKey?.match(LEGACY_PATTERN);
      if (!match) continue;
      const questionId = Number(match[1]);
      if (!Number.isSafeInteger(questionId) || questionId <= 0) continue;
      const raw = localStorage.getItem(storageKey!);
      if (!raw) continue;
      const entries = parseEntries(raw).filter((entry) => entry.text.trim().length > 0);
      if (entries.length) items.push({ question_id: questionId, entries });
    }
  } catch {
    return [];
  }
  return items;
}

let lastWriteOk = true;

/**
 * UX-PRA-36: every write is read back. False when storage is full, blocked
 * (private window) or returned something else, so the panel never claims
 * "Gespeichert" for a note that is not there.
 */
export function lastNotesWriteOk(): boolean {
  return lastWriteOk;
}

function writeNotes(questionId: number, entries: NoteEntry[], userId = currentNotesUserId()): void {
  lastWriteOk = false;
  if (typeof window === "undefined") return;
  const storageKey = noteStorageKey(questionId, userId);
  if (!storageKey) return;
  try {
    const nonEmpty = entries.filter((entry) => entry.text.trim().length > 0);
    const serialized = JSON.stringify(nonEmpty);
    if (nonEmpty.length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, serialized);
    const back = localStorage.getItem(storageKey);
    lastWriteOk = nonEmpty.length === 0 ? back === null : back === serialized;
    window.dispatchEvent(new CustomEvent("medpruef:notes-changed", { detail: { questionId, userId } }));
  } catch {
    /* localStorage may be unavailable: lastWriteOk stays false. */
  }
}

export function addNote(questionId: number, text: string, userId = currentNotesUserId()): NoteEntry[] {
  const trimmed = text.trim();
  if (!trimmed || !userId) return readNotes(questionId, userId);
  const entries = readNotes(questionId, userId).map((entry) =>
    entry.id === "legacy" ? { ...entry, id: newId() } : entry,
  );
  entries.push({ id: newId(), text: trimmed, updatedAt: Date.now() });
  writeNotes(questionId, entries, userId);
  return entries;
}

export function updateNote(questionId: number, id: string, text: string, userId = currentNotesUserId()): NoteEntry[] {
  if (!userId) return [];
  const entries = readNotes(questionId, userId).map((entry) =>
    entry.id === id ? { ...entry, text, updatedAt: Date.now() } : entry,
  );
  writeNotes(questionId, entries, userId);
  return entries;
}

export function deleteNote(questionId: number, id: string, userId = currentNotesUserId()): NoteEntry[] {
  if (!userId) return [];
  const entries = readNotes(questionId, userId).filter((entry) => entry.id !== id);
  writeNotes(questionId, entries, userId);
  return entries;
}

export function readNoteText(questionId: number, separator = "\n\n", userId = currentNotesUserId()): string {
  return readNotes(questionId, userId)
    .map((entry) => entry.text)
    .filter((text) => text.trim().length > 0)
    .join(separator);
}
