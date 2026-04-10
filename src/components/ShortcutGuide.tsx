"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface ShortcutGuideProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["A", "B", "C", "D", "E"], descDe: "Antwort auswählen", descEn: "Select answer" },
  { keys: ["F"], descDe: "Frage merken", descEn: "Bookmark question" },
  { keys: ["N", "\u2192"], descDe: "Nächste Frage", descEn: "Next question" },
  { keys: ["\u2318K"], descDe: "Suche öffnen", descEn: "Open search" },
  { keys: ["?"], descDe: "Tastenkürzel anzeigen", descEn: "Show shortcuts" },
  { keys: ["Esc"], descDe: "Schließen", descEn: "Close" },
];

export default function ShortcutGuide({ lang, open, onClose }: ShortcutGuideProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Card */}
      <div
        className="card relative z-10 w-full max-w-md mx-4 p-6 rounded-2xl shadow-xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-[#1A2B3C]">
            {t("shortcut_guide", lang)}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#A0AEC0] hover:text-[#4A5568] hover:bg-[#F7F9FC] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-[#E4E9F0] last:border-0">
              <span className="text-sm text-[#4A5568]">
                {lang === "de" ? s.descDe : s.descEn}
              </span>
              <div className="flex items-center gap-1">
                {s.keys.map((key, j) => (
                  <span key={j}>
                    {j > 0 && <span className="text-xs text-[#A0AEC0] mx-0.5">/</span>}
                    <kbd className="inline-block min-w-[28px] text-center px-2 py-1 text-xs font-mono font-semibold bg-[#F7F9FC] border border-[#E4E9F0] rounded-md text-[#1A2B3C] shadow-sm">
                      {key}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#A0AEC0] text-center mt-5">
          {t("press_to_close", lang)}
        </p>
      </div>
    </div>
  );
}
