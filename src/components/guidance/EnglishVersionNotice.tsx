"use client";

import { useEffect, useState } from "react";
import { getUiLang } from "@/lib/i18n";
import { englishVersionNotice } from "@/lib/guidance/language-fallback";

/**
 * GU-08 (a29): guidance pages exist in German and English only. A reader
 * whose chosen language is ru, uk, tr or ar gets the English page with this
 * visible line instead of a silent fallback. Renders nothing for German and
 * English readers and on the German page.
 */
export default function EnglishVersionNotice({ lang }: { lang: "de" | "en" }) {
  const [preference, setPreference] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPreference(getUiLang());
    } catch {
      setPreference(null);
    }
  }, []);
  const text = englishVersionNotice(preference, lang);
  if (!text) return null;
  return (
    <p
      lang="en"
      dir="ltr"
      data-testid="guidance-english-version"
      className="mb-4 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-3 py-2 text-sm text-[var(--mp-fg-muted)]"
    >
      {text}
    </p>
  );
}
