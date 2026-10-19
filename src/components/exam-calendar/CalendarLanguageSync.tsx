"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getUiLang, renderLang, setLang } from "@/lib/i18n";
import type { FormatLanguage } from "@/lib/exam-formats";
import EnglishVersionNotice from "@/components/guidance/EnglishVersionNotice";
/**
 * The same page in English, keeping every other query parameter
 * (a-lernplan-conversion-1019: the switch dropped ?exam=, a built plan's
 * bank, sitting and hours, and the utm tags of a post link).
 */
export function englishHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set("lang", "en");
  return `${pathname}?${params}`;
}

export default function CalendarLanguageSync({ lang, explicit }: { lang: FormatLanguage; explicit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    // ?lang only becomes a stored choice when it changes what the reader sees,
    // so a link carrying the current language never overwrites a ru/uk/tr/ar preference.
    if (explicit) { if (renderLang(getUiLang()) !== lang) setLang(lang); }
    else if (getUiLang() !== "de") router.replace(englishHref(pathname, window.location.search), { scroll: false });
  }, [lang, explicit, router, pathname]);
  return <EnglishVersionNotice lang={lang} />;
}
