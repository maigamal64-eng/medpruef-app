"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import GuidanceDocLayout from "@/components/guidance/GuidanceDocLayout";
import { getUiLang, renderLang } from "@/lib/i18n";

/**
 * Client chrome of an answer page: the guidance document layout (TOC, theme and
 * language toggles). The language lives in ?lang=, so the server renders the
 * full page in that language for crawlers; this only moves the URL. Same
 * behaviour as GuidanceShell: a stored English choice opens ?lang=en once, and
 * the toggle's mount call never rewrites the URL (a29).
 */
export default function AnswerShell({ lang, title, kicker, backHref, children }: {
  lang: "de" | "en"; title: string; kicker: string; backHref: string; children: ReactNode;
}) {
  const router = useRouter(); const pathname = usePathname(); const search = useSearchParams();
  useEffect(() => {
    let preferredEnglish = false;
    try { preferredEnglish = renderLang(getUiLang()) === "en"; } catch { /* keep the URL language */ }
    if (!search.has("lang") && preferredEnglish) {
      const params = new URLSearchParams(search.toString()); params.set("lang", "en");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [pathname, router, search]);
  // Long German compounds in a question h1 ("Prüfungsausschreibung") must
  // hyphenate at 320 to 375 px instead of widening the page.
  return <div lang={lang} className="[&_h1]:hyphens-auto [&_h1]:[overflow-wrap:anywhere] [&_h3]:hyphens-auto">
  <GuidanceDocLayout lang={lang} title={title} kicker={kicker} backHref={backHref} onLangChange={(next) => {
    let stored: string | null = null;
    try { stored = renderLang(getUiLang()); } catch { /* storage unavailable: trust the callback */ }
    if (next === lang || (stored !== null && next !== stored)) return;
    const params = new URLSearchParams(search.toString()); params.set("lang", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }}>
    {children}
  </GuidanceDocLayout>
  </div>;
}
