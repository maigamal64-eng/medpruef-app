"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getUiLang, renderLang, setLang } from "@/lib/i18n";
import type { FormatLanguage } from "@/lib/exam-formats";
import EnglishVersionNotice from "@/components/guidance/EnglishVersionNotice";
export default function CalendarLanguageSync({ lang, explicit }: { lang: FormatLanguage; explicit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    // ?lang only becomes a stored choice when it changes what the reader sees,
    // so a link carrying the current language never overwrites a ru/uk/tr/ar preference.
    if (explicit) { if (renderLang(getUiLang()) !== lang) setLang(lang); }
    else if (getUiLang() !== "de") router.replace(`${pathname}?lang=en`, { scroll: false });
  }, [lang, explicit, router, pathname]);
  return <EnglishVersionNotice lang={lang} />;
}
