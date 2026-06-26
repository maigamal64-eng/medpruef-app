"use client";

/**
 * QuestionNotesPanel — the ONE notes UI (FEEDBACK #4c).
 *
 * Self-contained multi-note editor backed by the shared `notes-store` (single
 * source of truth keyed `medpruef_notes_<id>`). Supports MULTIPLE notes per
 * question (add / edit / delete) and stays in sync with any other mounted notes
 * surface in the same tab via the `medpruef:notes-changed` event (and across
 * tabs via the native `storage` event).
 *
 * Previously this took a controlled single-string value from QuestionCard, and a
 * SECOND notes UI lived in QuestionActions — they wrote the same key as separate
 * React state, so they never synced and only one note was possible. Both of those
 * are gone now: this is the single home.
 */

import { useState, useEffect, useCallback } from "react";
import { FileText, Plus, Trash2, Check, X, Pencil } from "lucide-react";
import { t } from "@/lib/i18n";
import { Textarea } from "@/components/ui";
import {
  readNotes,
  addNote,
  updateNote,
  deleteNote,
  type NoteEntry,
} from "@/lib/notes-store";

type Lang = "de" | "en";

interface Props {
  lang: Lang;
  questionId: number;
}

// Back-compat: the legacy `getNoteKey` + `saveNoteToStorage` exports are still
// imported by QuestionCard's older code paths. Keep thin shims so nothing breaks
// while the store is the real owner.
export function getNoteKey(id: number) {
  return `medpruef_notes_${id}`;
}
export function saveNoteToStorage(id: number, value: string) {
  // Single-string legacy save → route through the multi-note store as one entry
  // (replacing any existing notes is NOT done here; this only appends if empty).
  if (typeof window === "undefined") return;
  const existing = readNotes(id);
  if (existing.length === 0 && value.trim()) addNote(id, value);
}

export default function QuestionNotesPanel({ lang, questionId }: Props) {
  const [entries, setEntries] = useState<NoteEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const reload = useCallback(() => {
    setEntries(readNotes(questionId));
  }, [questionId]);

  // Load on mount / question change, and stay in sync with other surfaces.
  useEffect(() => {
    reload();
    setDraft("");
    setEditingId(null);
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId?: number } | undefined;
      if (!detail || detail.questionId === questionId) reload();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === getNoteKey(questionId)) reload();
    };
    window.addEventListener("medpruef:notes-changed", onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("medpruef:notes-changed", onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [questionId, reload]);

  const handleAdd = () => {
    if (!draft.trim()) return;
    setEntries(addNote(questionId, draft));
    setDraft("");
  };

  const startEdit = (entry: NoteEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
  };

  const saveEdit = () => {
    if (editingId == null) return;
    setEntries(updateNote(questionId, editingId, editText));
    setEditingId(null);
    setEditText("");
  };

  const handleDelete = (id: string) => {
    setEntries(deleteNote(questionId, id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-xl shadow-[var(--shadow-xs)] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2">
        <FileText className="w-3 h-3 inline" /> {t("add_note", lang)}
        {entries.length > 0 && (
          <span className="ml-1 text-[var(--mp-fg-subtle)]">({entries.length})</span>
        )}
      </p>

      {/* Existing notes — each editable + deletable */}
      {entries.length > 0 && (
        <ul className="space-y-2 mb-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-2.5"
            >
              {editingId === entry.id ? (
                <div className="space-y-2">
                  <Textarea
                    label={t("add_note", lang)}
                    hideLabel
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveEdit}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--mp-viridian)]/15 border border-[var(--mp-viridian)]/30 text-[var(--mp-viridian)] text-xs font-medium rounded hover:bg-[var(--mp-viridian)]/25 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" /> {t("save_note", lang)}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      aria-label={lang === "de" ? "Abbrechen" : "Cancel"}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-[var(--mp-fg)] whitespace-pre-wrap break-words flex-1 min-w-0">
                    {entry.text}
                  </p>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(entry)}
                      aria-label={lang === "de" ? "Notiz bearbeiten" : "Edit note"}
                      className="p-1 rounded text-[var(--mp-fg-subtle)] hover:text-[var(--mp-viridian)] hover:bg-[var(--mp-surface-raised)] transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      aria-label={lang === "de" ? "Notiz löschen" : "Delete note"}
                      className="p-1 rounded text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)] hover:bg-[var(--mp-surface-raised)] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add a new note */}
      <Textarea
        label={t("add_note", lang)}
        hideLabel
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("note_placeholder", lang)}
        rows={3}
      />
      <div className="flex items-center justify-between mt-2">
        <button
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--mp-viridian)]/15 border border-[var(--mp-viridian)]/30 text-[var(--mp-viridian)] text-xs font-medium rounded hover:bg-[var(--mp-viridian)]/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          {entries.length > 0
            ? lang === "de"
              ? "Notiz hinzufügen"
              : "Add note"
            : t("save_note", lang)}
        </button>
        {draft.length > 0 && (
          <span className="text-[10px] text-[var(--mp-fg-subtle)]">
            {draft.length} {lang === "de" ? "Zeichen" : "chars"}
          </span>
        )}
      </div>
    </div>
  );
}
