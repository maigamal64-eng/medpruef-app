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
export default function AnswerShell({ lang, title, kicker, backHref, fixedUrl = false, children }: {
  lang: "de" | "en"; title: string; kicker: string; backHref: string;
  /** a-seo-articles-en-1019: the page has its own URL per language, so only an explicit pick moves it. */
  fixedUrl?: boolean; children: ReactNode;
}) {
  const router = useRouter(); const pathname = usePathname(); const search = useSearchParams();
  useEffect(() => {
    let preferredEnglish = false;
    try { preferredEnglish = renderLang(getUiLang()) === "en"; } catch { /* keep the URL language */ }
    // An English page (its own English URL) is already where this would go.
    if (lang !== "en" && !search.has("lang") && preferredEnglish) {
      const params = new URLSearchParams(search.toString()); params.set("lang", "en");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [lang, pathname, router, search]);
  // Long German compounds in a question h1 ("Prüfungsausschreibung") must
  // hyphenate at 320 to 375 px instead of widening the page.
  return <div lang={lang} className="[&_h1]:hyphens-auto [&_h1]:[overflow-wrap:anywhere] [&_h3]:hyphens-auto">
  <GuidanceDocLayout lang={lang} title={title} kicker={kicker} backHref={backHref} onLangChange={(next) => {
    let stored: string | null = null;
    try { stored = renderLang(getUiLang()); } catch { /* storage unavailable: trust the callback */ }
    if (next === lang || (stored !== null && next !== stored)) return;
    // The toggle's mount call reports the detected language (German for a de browser or a
    // crawler). On a per-language URL that must not move the page: act only on a stored pick.
    if (fixedUrl) {
      let picked: string | null = null;
      try { const raw = window.localStorage.getItem("medpruef-lang"); picked = raw ? (raw === "de" ? "de" : "en") : null; } catch { /* no storage: no explicit pick */ }
      if (picked !== next) return;
    }
    const params = new URLSearchParams(search.toString()); params.set("lang", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }}>
    {children}
  </GuidanceDocLayout>
  </div>;
}
