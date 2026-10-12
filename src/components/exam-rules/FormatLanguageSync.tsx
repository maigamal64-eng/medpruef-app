"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getUiLang, setLang } from "@/lib/i18n";
import type { FormatLanguage } from "@/lib/exam-formats";

/** Preserve the app preference while keeping both DE and EN server-rendered and directly linkable. */
export default function FormatLanguageSync({ lang, explicit }: { lang: FormatLanguage; explicit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (explicit) setLang(lang);
    else if (getUiLang() !== "de") router.replace(`${pathname}?lang=en`, { scroll: false });
  }, [lang, explicit, router, pathname]);
  return null;
}
