"use client";

import { useEffect } from "react";
import { useLang, renderLang, getUiLang } from "@/lib/i18n";

/**
 * Keeps the <html> element's `lang` and `dir` attributes in sync with the
 * chosen UI language (2026-07-03). Mounted once in the root layout. Flips
 * to dir="rtl" for Arabic. Renders nothing.
 */
export default function LangHtmlSync() {
  const lang = useLang();
  useEffect(() => {
    const el = document.documentElement;
    el.lang = renderLang(getUiLang());
    el.dir = "ltr";
  }, [lang]);
  return null;
}
