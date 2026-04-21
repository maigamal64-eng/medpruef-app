"use client";

/**
 * QuestionNotesPanel — the "Notizen" tab pane.
 *
 * Owns the textarea + save-to-localStorage wiring for per-question
 * user notes. Extracted from QuestionCard.tsx as part of the DD-15
 * burndown.
 *
 * The textarea value + "saved" confirmation are controlled by the
 * parent so that the UI reflects the latest state across question
 * changes and so tests can inspect the note without reaching into
 * localStorage.
 */

import { FileText } from "lucide-react";
import { t } from "@/lib/i18n";
import { Textarea } from "@/components/ui";

type Lang = "de" | "en";

interface Props {
  lang: Lang;
  value: string;
  onChange: (next: string) => void;
  saved: boolean;
  onSave: () => void;
}

function getNoteKey(id: number) {
  return `medpruef_notes_${id}`;
}

/** Persist a note to localStorage. Exposed so callers can trigger saves. */
export function saveNoteToStorage(id: number, value: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(getNoteKey(id), value);
}

export default function QuestionNotesPanel({
  lang,
  value,
  onChange,
  saved,
  onSave,
}: Props) {
  return (
    <div className="bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-xl shadow-[var(--shadow-xs)] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2">
        <FileText className="w-3 h-3 inline" /> {t("add_note", lang)}
      </p>
      <Textarea
        label={t("add_note", lang)}
        hideLabel
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("note_placeholder", lang)}
        rows={4}
      />
      <div className="flex items-center justify-between mt-2">
        <button
          onClick={onSave}
          className="px-3 py-1.5 bg-[var(--mp-viridian)]/15 border border-[var(--mp-viridian)]/30 text-[var(--mp-viridian)] text-xs font-medium rounded hover:bg-[var(--mp-viridian)]/25 transition-colors"
        >
          {saved ? `\u2713 ${t("note_saved", lang)}` : t("save_note", lang)}
        </button>
        {value.length > 0 && (
          <span className="text-[10px] text-[var(--mp-fg-subtle)]">
            {value.length} {lang === "de" ? "Zeichen" : "chars"}
          </span>
        )}
      </div>
    </div>
  );
}

export { getNoteKey };
