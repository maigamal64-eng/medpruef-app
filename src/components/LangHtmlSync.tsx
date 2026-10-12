"use client";

import { useEffect } from "react";
import { getUiLang, useLang } from "@/lib/i18n";
import { renderedLanguage } from "@/lib/master-locale/render";

/**
 * Keeps <html lang dir> naming the language actually rendered (UX-GLOBAL-02).
 * A preference whose review gate is still closed renders English, so it gets
 * lang="en" dir="ltr"; dir="rtl" appears only for reviewed Arabic copy. The
 * static head script (LANGUAGE_HEAD_SCRIPT) applies the same rule pre-paint.
 */
export default function LangHtmlSync() {
  const lang = useLang();
  useEffect(() => {
    const el = document.documentElement;
    // useLang() starts at 'de' before mount; read the stored preference
    // directly so the first write never contradicts the head script.
    void lang;
    const rendered = renderedLanguage(getUiLang());
    el.lang = rendered.lang;
    el.dir = rendered.dir;
  }, [lang]);
  return null;
}
