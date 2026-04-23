"use client";

type Lang = "de" | "en";

export default function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center bg-[var(--mp-surface-raised)] rounded-lg shadow-[var(--shadow-xs)] p-0.5 text-xs border border-[var(--mp-border)]">
      <button
        onClick={() => onChange("de")}
        className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
          lang === "de"
            ? "bg-[var(--mp-viridian)] text-white"
            : "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]"
        }`}
      >
        DE
      </button>
      <button
        onClick={() => onChange("en")}
        className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
          lang === "en"
            ? "bg-[var(--mp-viridian)] text-white"
            : "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]"
        }`}
      >
        EN
      </button>
    </div>
  );
}
