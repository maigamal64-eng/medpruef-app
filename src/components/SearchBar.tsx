"use client";

import { useEffect, useRef, useState } from "react";

type Lang = "de" | "en";

interface SearchBarProps {
  lang: Lang;
  onSearch: (query: string) => void;
  autoFocus?: boolean;
}

/**
 * Detect Mac via userAgent. SSR-safe — default to Mac to avoid
 * first-paint flicker of the ⌘K chip; client effect re-evaluates.
 */
function useIsMac() {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent || ""));
  }, []);
  return isMac;
}

export default function SearchBar({ lang, onSearch, autoFocus }: SearchBarProps) {
  const [value, setValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = useIsMac();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSearch(v.trim());
    }, 300);
  };

  const handleClear = () => {
    setValue("");
    onSearch("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative flex items-center">
      {/* Search icon */}
      <span className="absolute left-3.5 text-[var(--mp-fg-subtle)] pointer-events-none text-lg leading-none">
        🔍
      </span>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={lang === "de" ? "Frage suchen..." : "Search questions..."}
        className="w-full bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-xl shadow-[var(--shadow-xs)] pl-10 pr-9 py-3 text-base text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]/50 focus:shadow-[0_0_0_3px_rgba(0,123,95,0.15)] transition-all"
      />

      {/* Clear button */}
      {value ? (
        <button
          onClick={handleClear}
          className="absolute right-3 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors text-sm leading-none"
          aria-label={lang === "de" ? "Suche löschen" : "Clear search"}
        >
          ✕
        </button>
      ) : (
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 text-[10px] text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded px-1.5 py-0.5 pointer-events-none font-mono"
          aria-hidden
          title={
            lang === "de"
              ? `Tipp: drücke ${isMac ? "⌘K" : "Ctrl+K"} von überall`
              : `Tip: press ${isMac ? "⌘K" : "Ctrl+K"} anywhere`
          }
        >
          {isMac ? "⌘" : "Ctrl"}
          <span>K</span>
        </span>
      )}
    </div>
  );
}
