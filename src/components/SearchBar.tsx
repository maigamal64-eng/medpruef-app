"use client";

import { useEffect, useRef, useState } from "react";

type Lang = "de" | "en";

interface SearchBarProps {
  lang: Lang;
  onSearch: (query: string) => void;
  autoFocus?: boolean;
}

export default function SearchBar({ lang, onSearch, autoFocus }: SearchBarProps) {
  const [value, setValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <span className="absolute left-3 text-[#879391] pointer-events-none text-base leading-none">
        🔍
      </span>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={lang === "de" ? "Frage suchen..." : "Search questions..."}
        className="w-full bg-[#191F31] border border-[#3D4947] rounded pl-9 pr-9 py-2.5 text-sm text-[#DCE1FB] placeholder-[#879391] focus:outline-none focus:border-[#6BD8CB]/50 transition-colors"
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-3 text-[#879391] hover:text-[#BCC9C6] transition-colors text-sm leading-none"
          aria-label={lang === "de" ? "Suche löschen" : "Clear search"}
        >
          ✕
        </button>
      )}
    </div>
  );
}
