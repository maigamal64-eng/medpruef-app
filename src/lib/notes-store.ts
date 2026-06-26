/**
 * notes-store — the ONE per-question notes model (FEEDBACK #4c).
 *
 * Before this, two UIs (QuestionActions' NotePanel + QuestionCard's ContextTabs
 * Notizen pane) wrote the same localStorage key `medpruef_notes_<id>` as two
 * separate React states, so they never synced live, and the key held a single
 * string (one note, no "add more"). This module is the single source of truth:
 *
 *  - Storage key stays `medpruef_notes_<id>` (so existence-based readers — the
 *    progress count, the exam `readNoteIds` scanner, the bookmarks/notes filter
 *    — keep working unchanged).
 *  - The value is now a JSON array of note entries. A LEGACY plain string is
 *    read transparently as a single-entry list, so nothing breaks on upgrade.
 *  - All writers go through here, so every surface reflects the same notes.
 *
 * Notes live in localStorage only (no server table for user notes yet), matching
 * the prior behaviour — this is a client-side model, not a schema change.
 */

export interface NoteEntry {
  /** Stable id for the entry (timestamp-based; unique enough for a single user). */
  id: string;
  text: string;
  /** epoch ms */
  updatedAt: number;
}

function key(questionId: number): string {
  return `medpruef_notes_${questionId}`;
}

function newId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Read all note entries for a question. Transparently upgrades a legacy
 *  single-string value into a one-entry list. Never throws. */
export function readNotes(questionId: number): NoteEntry[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(questionId));
  } catch {
    return [];
  }
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // New format: JSON array of entries.
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr
          .filter((e) => e && typeof e.text === "string")
          .map((e) => ({
            id: typeof e.id === "string" ? e.id : newId(),
            text: e.text,
            updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
          }));
      }
    } catch {
      // fall through — treat as a legacy string
    }
  }
  // Legacy format: a single plain-string note.
  return [{ id: "legacy", text: raw, updatedAt: Date.now() }];
}

/** Persist the full entry list. Removes the key entirely when the list is empty
 *  (so the question stops being counted as "has a note"). Never throws. */
function writeNotes(questionId: number, entries: NoteEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const nonEmpty = entries.filter((e) => e.text.trim().length > 0);
    if (nonEmpty.length === 0) {
      localStorage.removeItem(key(questionId));
    } else {
      localStorage.setItem(key(questionId), JSON.stringify(nonEmpty));
    }
    // Notify other mounted surfaces in THIS tab (the native `storage` event only
    // fires in OTHER tabs). Both QuestionActions and the ContextTabs pane listen
    // for this so notes stay in sync live.
    window.dispatchEvent(new CustomEvent("medpruef:notes-changed", { detail: { questionId } }));
  } catch {
    /* localStorage may be unavailable — non-fatal */
  }
}

/** Add a new note. Returns the updated list. */
export function addNote(questionId: number, text: string): NoteEntry[] {
  const t = text.trim();
  if (!t) return readNotes(questionId);
  const entries = readNotes(questionId);
  // A "legacy" single entry gets a real id once it is part of a managed list.
  const normalised = entries.map((e) =>
    e.id === "legacy" ? { ...e, id: newId() } : e,
  );
  normalised.push({ id: newId(), text: t, updatedAt: Date.now() });
  writeNotes(questionId, normalised);
  return normalised;
}

/** Update one entry by id. Returns the updated list. */
export function updateNote(questionId: number, id: string, text: string): NoteEntry[] {
  const entries = readNotes(questionId).map((e) =>
    e.id === id ? { ...e, text, updatedAt: Date.now() } : e,
  );
  writeNotes(questionId, entries);
  return entries;
}

/** Delete one entry by id. Returns the updated list. */
export function deleteNote(questionId: number, id: string): NoteEntry[] {
  const entries = readNotes(questionId).filter((e) => e.id !== id);
  writeNotes(questionId, entries);
  return entries;
}

/** Joined plain-text of all notes for a question — used by read-only surfaces
 *  (progress list preview, exports) that just need the text. */
export function readNoteText(questionId: number, separator = "\n\n"): string {
  return readNotes(questionId)
    .map((e) => e.text)
    .filter((t) => t.trim().length > 0)
    .join(separator);
}
