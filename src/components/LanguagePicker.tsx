"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { LIVE_LANGS, LANG_LABELS, setLang, useLang, type Lang } from "@/lib/i18n";

/**
 * Self-contained global language picker (2026-07-03). Offers every language
 * in LIVE_LANGS (de/en/ru/tr now; uk/ar as they go live), writes the choice
 * to the shared global lang so the whole app chrome (via useLang + t) follows.
 * Legacy pages with their own de/en content maps fall back to English for
 * other languages, which is safe and not blank. Compact globe dropdown.
 */
export default function LanguagePicker({ className = "" }: { className?: string }) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = LANG_LABELS[lang] ?? "Language";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className="flex items-center gap-1.5 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-2.5 py-1.5 text-xs font-medium text-[var(--mp-fg-muted)] transition-colors hover:text-[var(--mp-fg)]"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="uppercase">{lang}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 min-w-[9rem] overflow-hidden rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] py-1 shadow-xl"
        >
          {LIVE_LANGS.map((l: Lang) => {
            const active = l === lang;
            return (
              <li key={l}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setLang(l);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                  dir={l === "ar" ? "rtl" : "ltr"}
                >
                  <span>{LANG_LABELS[l]}</span>
                  {active && <Check className="h-3.5 w-3.5 text-[var(--mp-viridian)]" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
