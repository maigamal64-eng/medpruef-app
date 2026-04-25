"use client";

/**
 * LangAttributeSync — keeps `document.documentElement.lang` in sync with
 * the user's chosen language (review-2026-04-25-B9).
 *
 * The root <html lang> attribute in `app/layout.tsx` is statically set to
 * "de" — that's correct for SSR (the canonical primary language) but
 * wrong after a user toggles to English in `/settings`. Screen readers
 * (NVDA, VoiceOver) read English text with German pronunciation rules,
 * Chrome's translation prompt offers to translate the page back to
 * German, and Hreflang signals get muddled.
 *
 * `layout.tsx` is a Server Component, so we can't reactively bind
 * `<html lang>` from there. This Client component runs once on mount,
 * reads the persisted `medpruef-lang` localStorage key, and updates
 * `document.documentElement.lang`. It also subscribes to a global
 * `medpruef:lang-change` event so any in-app language toggle can
 * broadcast the change without prop-drilling.
 *
 * `dir` stays `ltr` for now — Arabic UI (RTL) is not yet a supported
 * language, only AR question explanations (rendered inside a
 * `dir="rtl"` block in `TranslateButton.tsx`).
 *
 * Mounted from `ThemeProvider.tsx` (which already runs on every page).
 */

import { useEffect } from "react";

const STORAGE_KEY = "medpruef-lang";
// Matches the event dispatched by `setLang()` in src/lib/i18n.ts (hyphen
// form, not colon). Using the existing convention so this hook reacts
// to every language toggle in the app without changing the publisher.
const EVENT_NAME = "medpruef-lang-change";

function applyLang(lang: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  // Only valid 2-letter language codes. Defends against corrupted
  // localStorage / a future bug that writes a non-string.
  if (typeof lang === "string" && /^[a-z]{2}$/i.test(lang)) {
    el.lang = lang.toLowerCase();
  } else {
    el.lang = "de";
  }
}

export default function LangAttributeSync() {
  useEffect(() => {
    // Initial sync on mount — read the persisted lang and apply it.
    try {
      applyLang(localStorage.getItem(STORAGE_KEY));
    } catch {
      // localStorage may be disabled (private browsing); fall back to "de".
      applyLang("de");
    }

    // React to in-app language toggles. Components that change the
    // language should `dispatchEvent(new CustomEvent("medpruef:lang-change", { detail: lang }))`.
    const onLangChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      applyLang(typeof detail === "string" ? detail : null);
    };
    // Also react to localStorage changes from other tabs.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) applyLang(e.newValue);
    };

    window.addEventListener(EVENT_NAME, onLangChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onLangChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
