"use client";

import { useState } from "react";
import { studyShortcutsEnabled, setStudyShortcutsEnabled } from "@/lib/study-shortcuts";
import { t } from "@/lib/i18n";
import { Dialog } from "@/components/ui";

type Lang = "de" | "en";

interface ShortcutGuideProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  study?: "quiz" | "flashcards";
}

const SHORTCUTS = [
  { keys: ["A", "B", "C", "D", "E"], descDe: "Antwort auswählen", descEn: "Select answer" },
  { keys: ["F"], descDe: "Frage merken", descEn: "Bookmark question" },
  { keys: ["N", "\u2192"], descDe: "Nächste Frage", descEn: "Next question" },
  { keys: ["\u2318K"], descDe: "Suche öffnen", descEn: "Open search" },
  { keys: ["?"], descDe: "Tastenkürzel anzeigen", descEn: "Show shortcuts" },
  { keys: ["Esc"], descDe: "Schließen", descEn: "Close" },
];

export default function ShortcutGuide({ lang, open, onClose, study }: ShortcutGuideProps) {
  const [enabled, setEnabled] = useState(studyShortcutsEnabled);
  const shortcuts = study === 'flashcards' ? [
    { keys: ['Enter', 'Space'], descDe: 'Fokussierten Knopf aktivieren', descEn: 'Activate focused button' },
    { keys: ['1', '2', '3', '4'], descDe: 'Karte bewerten', descEn: 'Rate card' },
  ] : study ? [
    { keys: ['A-E', '1-5'], descDe: 'Antwort auswählen', descEn: 'Select answer' },
    { keys: ['Enter', 'Space'], descDe: 'Fokussierten Knopf aktivieren', descEn: 'Activate focused button' },
    ...SHORTCUTS.slice(1, 3),
  ] : SHORTCUTS;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("shortcut_guide", lang)}
      maxWidth="440px"
    >
      {study && <label className="flex min-h-11 items-center gap-3 mb-3 text-sm">
        <input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setStudyShortcutsEnabled(event.target.checked); }} />
        {t('study_shortcuts_enabled', lang)}
      </label>}
      <div className="space-y-3">
        {shortcuts.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-2 border-b border-[var(--mp-border)] last:border-0"
          >
            <span className="text-sm text-[var(--mp-fg-muted)]">
              {lang === "de" ? s.descDe : s.descEn}
            </span>
            <div className="flex items-center gap-1">
              {s.keys.map((key, j) => (
                <span key={j}>
                  {j > 0 && <span className="text-xs text-[var(--mp-fg-subtle)] mx-0.5">/</span>}
                  <kbd className="inline-block min-w-[28px] text-center px-2 py-1 text-xs font-mono font-semibold bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-md text-[var(--mp-fg)] shadow-sm">
                    {key}
                  </kbd>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[var(--mp-fg-subtle)] text-center mt-5">
        {t("press_to_close", lang)}
      </p>
    </Dialog>
  );
}
